#include <drogon/drogon.h>
#include <thread>
#include <atomic>
#include <csignal>
#include <poll.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <cerrno>
#include <cstring>
#include <iostream>
#include <filesystem>
#include <vector>
#include <fstream>
#include <optional>
#include <chrono>
#include <jwt-cpp/jwt.h>

static std::atomic<bool> g_stop{false};
static int g_server_fd = -1;

int start_server();
int server_tcp();

// ========== Helpers JWT / SPA ==========

static inline bool isSpaPath(std::string_view p) {
    if (p.rfind("/api/", 0) == 0) return false; // não intercepta API
    static const char* staticPrefixes[] = {
        "/assets/", "/static/", "/img/", "/images/", "/js/", "/css/", "/fonts/"
    };
    for (auto pref : staticPrefixes) {
        if (p.rfind(pref, 0) == 0) return false;
    }
    if (p == "/favicon.ico" || p == "/robots.txt" || p == "/sitemap.xml") return false;
    // sem extensão -> rota do SPA
    return p.find('.') == std::string::npos;
}

static inline std::string getJwtSecret() {
    const char* env = std::getenv("JWT_SECRET");
    return (env && *env) ? std::string(env) : "dev-secret-change-me";
}

static inline std::optional<std::string> extractBearerOrCookie(const drogon::HttpRequestPtr& req) {
    const std::string prefix = "Bearer ";
    auto auth = req->getHeader("Authorization");
    if (!auth.empty() && auth.size() > prefix.size() && auth.rfind(prefix, 0) == 0) {
        return auth.substr(prefix.size());
    }
    auto c = req->getCookie("access_token");
    if (!c.empty()) return c;
    return std::nullopt;
}

static inline bool jwtIsValid(const std::string& token) {
    try {
        auto dec = jwt::decode(token);
        auto ver = jwt::verify()
            .with_issuer("aterro_web")
            .allow_algorithm(jwt::algorithm::hs256{getJwtSecret()});
        ver.verify(dec);
        if (dec.has_expires_at()) {
            const auto now = std::chrono::system_clock::now();
            if (now >= dec.get_expires_at()) return false;
        }
        return true;
    } catch (const std::exception& e) {
        std::cerr << "[SPA] jwt inválido: " << e.what() << "\n";
        return false;
    }
}

// ========== Sinais ==========

extern "C" void on_signal(int) {
    g_stop.store(true);
    drogon::app().quit();                 // faz app().run() retornar
    if (g_server_fd != -1) {
        shutdown(g_server_fd, SHUT_RDWR); // acorda poll/accept do TCP
    }
}

int main() {
    std::signal(SIGPIPE, SIG_IGN);  // evita abort quando cliente fecha socket
    std::signal(SIGINT,  on_signal);
    std::signal(SIGTERM, on_signal);

    std::thread t1(start_server);   // HTTP + SPA fallback protegido
    std::thread t2(server_tcp);     // Servidor TCP simples (2020)

    t1.join();
    t2.join();
    return 0;
}

// ========== Servidor HTTP (Drogon) ==========

int start_server() {
    using namespace drogon;
    namespace fs = std::filesystem;

    // pasta onde ficam os JSON que você quer ler via /api/json/{name}
    const fs::path jsonBaseDir = "/home/victor/code/aterro_web/server/Dados/";

    // 1) Carrega config.json (env > absoluto > local)
    const char* envCfg = std::getenv("DROGON_CONFIG_FILE");
    std::vector<fs::path> candidates;
    if (envCfg && *envCfg) candidates.emplace_back(envCfg);
    candidates.emplace_back("/home/victor/code/aterro_web/server/config.json");
    candidates.emplace_back("config.json");

    bool loaded = false;
    for (const auto& p : candidates) {
        if (fs::exists(p) && fs::is_regular_file(p)) {   // evita diretório tipo "Dados/"
            std::cout << "[Drogon] loading config: " << p << "\n";
            drogon::app().loadConfigFile(p.string());
            loaded = true;
            break;
        }
    }
    if (!loaded) {
        std::cerr << "[Drogon] config.json NÃO encontrado; usando fallback (HTTP:7080)\n";
        drogon::app()
            .addListener("0.0.0.0", 7080, /*https=*/false)
            .setDocumentRoot("/home/victor/code/aterro_web/client/dist")
            .setLogLevel(trantor::Logger::kInfo);
    }

    // 2) Confirma/força document_root correto
    auto root = app().getDocumentRoot();
    auto indexPath = (fs::path(root) / "index.html").string();
    if (!fs::exists(indexPath)) {
        std::cerr << "[Drogon] index.html NÃO encontrado em: " << indexPath << "\n"
                  << "          Forçando document_root para /home/victor/code/aterro_web/client/dist\n";
        app().setDocumentRoot("/home/victor/code/aterro_web/client/dist");
        root = app().getDocumentRoot();
        indexPath = (fs::path(root) / "index.html").string();
    }
    std::cout << "[Drogon] document_root=" << root
              << " | index.html exists=" << (fs::exists(indexPath) ? "yes":"no") << "\n";

    // 3) Advice “no-op” (pode até remover se quiser)
    app().registerPostRoutingAdvice([](const HttpRequestPtr &req,
                                       AdviceCallback &&cb,
                                       AdviceChainCallback &&forward){
        (void)req; (void)cb; forward();
    });

    // 4) SPA fallback PROTEGIDO (com checagem de Accept e exceções de API)
    app().registerPreRoutingAdvice(
        [indexPath](const drogon::HttpRequestPtr& req,
                    drogon::AdviceCallback&& cb,
                    drogon::AdviceChainCallback&& forward) {
            using namespace drogon;

            // Só nos interessa GET
            if (req->method() != Get) return forward();

            const auto path = req->path();

            // APIs não são tratadas pelo SPA
            if (path.rfind("/api/", 0) == 0 || path == "/me" || path == "/logout") {
                return forward();
            }

            // Se não for rota de SPA (arquivo estático etc.), deixa seguir
            if (!isSpaPath(path)) return forward();

            // Só faça fallback do SPA se o cliente aceita HTML (ou não especificou)
            const auto accept = req->getHeader("Accept");
            if (!accept.empty() &&
                accept.find("text/html") == std::string::npos &&
                accept.find("*/*") == std::string::npos) {
                // fetch XHR (application/json etc.) -> deixe seguir
                return forward();
            }

            // Rota pública do SPA
            if (path == "/login") {
                std::cerr << "[SPA] path=" << path << " -> public\n";
                auto resp = HttpResponse::newFileResponse(indexPath);
                resp->setStatusCode(k200OK);
                resp->addHeader("Cache-Control", "no-store");
                return cb(std::move(resp));
            }

            // Tela de cadastro só local (localhost/loopback)
            if (path == "/signup") {
                if (!req->getPeerAddr().isLoopbackIp()) {
                    auto resp = HttpResponse::newHttpResponse();
                    resp->setStatusCode(k403Forbidden);
                    resp->setBody("Cadastro disponível apenas na máquina local");
                    return cb(std::move(resp));
                }

                auto resp = HttpResponse::newFileResponse(indexPath);
                resp->setStatusCode(k200OK);
                resp->addHeader("Cache-Control", "no-store");
                return cb(std::move(resp));
            }

            // Demais rotas do SPA exigem JWT válido (cookie ou Bearer)
            auto tok = extractBearerOrCookie(req);
            if (!tok || !jwtIsValid(*tok)) {
                std::cerr << "[SPA] path=" << path << " -> sem/ruim token, redirect /login\n";
                auto resp = HttpResponse::newHttpResponse();
                resp->setStatusCode(k302Found);
                resp->addHeader("Location", "/login");
                return cb(std::move(resp));
            }

            std::cerr << "[SPA] path=" << path << " -> OK\n";
            auto resp = HttpResponse::newFileResponse(indexPath);
            resp->setStatusCode(k200OK);
            resp->addHeader("Cache-Control", "no-store");
            cb(std::move(resp));
        }
    );

    // 5) Endpoint protegido para ler JSON do servidor
    app().registerHandler(
        "/api/json/{name}",
        [jsonBaseDir](const drogon::HttpRequestPtr& req,
                      std::function<void(const drogon::HttpResponsePtr&)>&& cb,
                      const std::string& name) {
            using namespace drogon;
            namespace fs = std::filesystem;

            // Só GET
            if (req->method() != Get) {
                auto resp = HttpResponse::newHttpResponse();
                resp->setStatusCode(k405MethodNotAllowed);
                resp->setBody("Método não permitido");
                return cb(std::move(resp));
            }

            // Autenticação via JWT (cookie ou Bearer)
            auto tok = extractBearerOrCookie(req);
            if (!tok || !jwtIsValid(*tok)) {
                auto resp = HttpResponse::newHttpResponse();
                resp->setStatusCode(k401Unauthorized);
                resp->setBody("Não autorizado");
                return cb(std::move(resp));
            }

            // Segurança básica do nome do arquivo
            if (name.find("..") != std::string::npos ||
                name.find('/')  != std::string::npos ||
                name.find('\\') != std::string::npos) {
                auto resp = HttpResponse::newHttpResponse();
                resp->setStatusCode(k400BadRequest);
                resp->setBody("Nome de arquivo inválido");
                return cb(std::move(resp));
            }

            // Garante extensão .json
            std::string fname = name;
            if (!fname.empty() && (fname.size() < 5 || fname.rfind(".json") != fname.size() - 5)) {
                fname += ".json";
            }

            fs::path filePath = jsonBaseDir / fname;
            if (!fs::exists(filePath)) {
                auto resp = HttpResponse::newHttpResponse();
                resp->setStatusCode(k404NotFound);
                resp->setBody("Arquivo não encontrado");
                return cb(std::move(resp));
            }

            // Lê o arquivo e faz parse como JSON
            std::ifstream in(filePath);
            if (!in.is_open()) {
                auto resp = HttpResponse::newHttpResponse();
                resp->setStatusCode(k500InternalServerError);
                resp->setBody("Falha ao abrir arquivo");
                return cb(std::move(resp));
            }

            Json::Value root;
            in >> root;
            if (in.fail()) {
                auto resp = HttpResponse::newHttpResponse();
                resp->setStatusCode(k500InternalServerError);
                resp->setBody("Conteúdo não é um JSON válido");
                return cb(std::move(resp));
            }

            auto resp = HttpResponse::newHttpJsonResponse(root);
            resp->setStatusCode(k200OK);
            cb(std::move(resp));
        },
        {drogon::Get} // só GET
    );

    app().run();
    return 0;
}

// ========== Servidor TCP Puro ==========

int server_tcp() {
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd == -1) {
        perror("socket falhou");
        return 1;
    }
    g_server_fd = server_fd;

    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR | SO_REUSEPORT, &opt, sizeof(opt));

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(2020);

    if (bind(server_fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
        perror("bind falhou");
        close(server_fd);
        g_server_fd = -1;
        return 1;
    }

    if (listen(server_fd, 64) < 0) {
        perror("listen falhou");
        close(server_fd);
        g_server_fd = -1;
        return 1;
    }

    std::cout << "[TCP] Servidor aguardando conexões na porta 2020...\n";

    pollfd pfd{};
    pfd.fd = server_fd;
    pfd.events = POLLIN;

    while (!g_stop.load()) {
        int r = poll(&pfd, 1, 500); // 500ms
        if (r < 0) {
            if (errno == EINTR) continue;
            perror("poll falhou");
            break;
        }
        if (r == 0) continue;

        if (pfd.revents & POLLIN) {
            sockaddr_in cli{};
            socklen_t len = sizeof(cli);
            int new_socket = accept(server_fd, (sockaddr *)&cli, &len);
            if (new_socket < 0) {
                if (errno == EINTR) continue;
                if (g_stop.load()) break;
                perror("accept falhou");
                continue;
            }

            char buffer[1024] = {0};
            ssize_t n = read(new_socket, buffer, sizeof(buffer));
            if (n > 0) {
                std::cout << "[TCP] Mensagem recebida: " << buffer << std::endl;
                const char *hello = "Olá do servidor TCP!";
                send(new_socket, hello, strlen(hello), 0);
                std::cout << "[TCP] Resposta enviada.\n";
            }
            close(new_socket);
        }
    }

    close(server_fd);
    g_server_fd = -1;
    std::cout << "[TCP] Encerrado.\n";
    return 0;
}
