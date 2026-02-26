#include "AuthController.h"
#include <drogon/drogon.h>
#include <json/json.h>
#include <jwt-cpp/jwt.h>
#include <unordered_map>
#include <mutex>
#include <optional>
#include <chrono>
#include <cstdlib>
#include <algorithm>
#include <cctype>              // <- para std::isalnum
#include <filesystem>
#include <fstream>
#include <iostream>
#include "bcrypt_xcrypt.hpp"   // precisa estar em include/ e no include path

// ---------------- helpers ----------------

namespace {
// username -> bcrypt_hash (simulação; troque por DB real)
std::unordered_map<std::string, std::string> g_users;
std::mutex g_users_mtx;
bool g_users_loaded = false;

std::filesystem::path usersDbPath() {
    return std::filesystem::path("Dados/users/users.json");
}

bool loadUsersFromDiskLocked() {
    if (g_users_loaded) return true;
    g_users_loaded = true;

    const auto path = usersDbPath();
    if (!std::filesystem::exists(path)) return true;

    std::ifstream in(path);
    if (!in.is_open()) {
        std::cerr << "[auth] falha ao abrir users.json\n";
        g_users_loaded = false;
        return false;
    }

    Json::Value root;
    Json::CharReaderBuilder rbuilder;
    std::string errs;
    if (!Json::parseFromStream(rbuilder, in, &root, &errs)) {
        std::cerr << "[auth] users.json inválido: " << errs << "\n";
        g_users_loaded = false;
        return false;
    }

    const auto users = root["users"];
    if (!users.isObject()) return true;

    for (const auto& name : users.getMemberNames()) {
        const auto& val = users[name];
        if (val.isString()) {
            g_users[name] = val.asString();
        }
    }
    return true;
}

bool saveUsersToDiskLocked() {
    const auto path = usersDbPath();
    std::error_code ec;
    std::filesystem::create_directories(path.parent_path(), ec);
    if (ec) {
        std::cerr << "[auth] falha ao criar pasta users: " << ec.message() << "\n";
        return false;
    }

    Json::Value root;
    Json::Value users(Json::objectValue);
    for (const auto& [name, hash] : g_users) {
        users[name] = hash;
    }
    root["users"] = users;

    Json::StreamWriterBuilder wbuilder;
    wbuilder["indentation"] = "";
    const auto serialized = Json::writeString(wbuilder, root);

    const auto tmpPath = path.string() + ".tmp";
    {
        std::ofstream out(tmpPath, std::ios::trunc);
        if (!out.is_open()) {
            std::cerr << "[auth] falha ao escrever users.json.tmp\n";
            return false;
        }
        out << serialized;
        if (!out.good()) {
            std::cerr << "[auth] falha ao gravar users.json.tmp\n";
            return false;
        }
    }

    std::filesystem::rename(tmpPath, path, ec);
    if (ec) {
        std::cerr << "[auth] falha ao mover users.json: " << ec.message() << "\n";
        return false;
    }
    return true;
}

// apaga conteúdo sensível (best effort)
void wipe(std::string &s) {
    std::fill(s.begin(), s.end(), '\0');
    s.clear();
}

// detecta HTTPS (direto ou via proxy/túnel)
bool isHttps(const drogon::HttpRequestPtr& req) {
    auto xfproto = req->getHeader("X-Forwarded-Proto");
    if (!xfproto.empty()) {
        return xfproto == "https" || xfproto == "HTTPS";
    }
    return req->isOnSecureConnection();
}

std::string normalizeHost(std::string host) {
    host.erase(
        std::remove_if(host.begin(), host.end(), [](unsigned char ch) { return std::isspace(ch); }),
        host.end());

    if (host.empty()) return host;

    if (host.front() == '[') {
        const auto endBracket = host.find(']');
        if (endBracket != std::string::npos) {
            host = host.substr(1, endBracket - 1);
        }
    } else {
        const auto colonPos = host.find(':');
        if (colonPos != std::string::npos) {
            host = host.substr(0, colonPos);
        }
    }

    std::transform(host.begin(), host.end(), host.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return host;
}

bool isLocalHostHeader(const std::string& hostHeader) {
    if (hostHeader.empty()) return true; // fallback para clientes sem Host (HTTP/1.0)
    const auto host = normalizeHost(hostHeader);
    return host == "localhost" || host == "127.0.0.1" || host == "::1";
}

bool hasForwardingHeaders(const drogon::HttpRequestPtr& req) {
    return !req->getHeader("X-Forwarded-For").empty() ||
           !req->getHeader("X-Real-IP").empty() ||
           !req->getHeader("Forwarded").empty();
}

// permite cadastro apenas a partir da própria máquina do servidor
bool isLocalSignupAllowed(const drogon::HttpRequestPtr& req) {
    if (!req->getPeerAddr().isLoopbackIp()) return false;
    if (hasForwardingHeaders(req)) return false;
    return isLocalHostHeader(req->getHeader("Host"));
}

// extrai token "Bearer ..." ou cookie "access_token"
std::optional<std::string> extractToken(const drogon::HttpRequestPtr& req) {
    auto auth = req->getHeader("Authorization");
    if (!auth.empty()) {
        const std::string prefix = "Bearer ";
        if (auth.size() > prefix.size() && auth.rfind(prefix, 0) == 0) {
            return auth.substr(prefix.size());
        }
    }
    auto c = req->getCookie("access_token");
    if (!c.empty()) return c;
    return std::nullopt;
}

// validações simples de username
bool validUsername(const std::string& u) {
    if (u.size() < 3 || u.size() > 32) return false;
    for (unsigned char c : u) {
        if (!(std::isalnum(c) || c == '_' || c == '.' || c == '-')) return false;
    }
    return true;
}

Json::Value makeError(const std::string& msg) {
    Json::Value v;
    v["error"] = msg;
    return v;
}

Json::Value makeMessage(const std::string& msg) {
    Json::Value v;
    v["message"] = msg;
    return v;
}
} // anon

using namespace drogon;

// ---------------- AuthController ----------------

std::string AuthController::jwtSecret() const {
    const char* env = std::getenv("JWT_SECRET");
    if (env && *env) return std::string(env);
    // Fallback de DEV (trocar em produção!)
    return "dev-secret-change-me";
}

std::string AuthController::issueJwtFor(const std::string& username) const {
    const auto now = std::chrono::system_clock::now();
    const auto exp = now + std::chrono::hours(12); // expiração padrão: 12h
    return jwt::create()
        .set_type("JWS")
        .set_issuer("aterro_web")
        .set_subject(username)
        .set_issued_at(now)
        .set_expires_at(exp)
        .sign(jwt::algorithm::hs256{jwtSecret()});
}

void AuthController::signup(const HttpRequestPtr &req,
                            std::function<void (const HttpResponsePtr &)> &&cb) {
    if (!isLocalSignupAllowed(req)) {
        auto r = HttpResponse::newHttpJsonResponse(
            makeError("Cadastro permitido apenas em localhost na máquina do servidor"));
        r->setStatusCode(k403Forbidden);
        return cb(r);
    }

    auto json = req->getJsonObject();
    if (!json || !json->isMember("username") || !json->isMember("password")) {
        auto r = HttpResponse::newHttpJsonResponse(makeError("Dados inválidos"));
        r->setStatusCode(k400BadRequest);
        return cb(r);
    }

    std::string username = (*json)["username"].asString();
    std::string pass     = (*json)["password"].asString();

    if (!validUsername(username) || pass.size() < 8) {
        wipe(pass);
        auto r = HttpResponse::newHttpJsonResponse(makeError("Username ou senha inválidos"));
        r->setStatusCode(k400BadRequest);
        return cb(r);
    }

    std::string hash;
    try {
        hash = bcrypt_hash(pass, /*cost*/12);
    } catch (const std::exception&) {
        wipe(pass);
        auto r = HttpResponse::newHttpJsonResponse(makeError("Falha ao gerar hash"));
        r->setStatusCode(k500InternalServerError);
        return cb(r);
    }
    wipe(pass);

    {
        std::lock_guard<std::mutex> lock(g_users_mtx);
        if (!loadUsersFromDiskLocked()) {
            auto r = HttpResponse::newHttpJsonResponse(makeError("Falha ao carregar usuários"));
            r->setStatusCode(k500InternalServerError);
            return cb(r);
        }
        auto it = g_users.find(username);
        if (it != g_users.end()) {
            const auto oldHash = it->second;
            it->second = std::move(hash);
            if (!saveUsersToDiskLocked()) {
                it->second = oldHash;
                auto r = HttpResponse::newHttpJsonResponse(makeError("Falha ao salvar usuário"));
                r->setStatusCode(k500InternalServerError);
                return cb(r);
            }
            auto r = HttpResponse::newHttpJsonResponse(makeMessage("Senha atualizada com sucesso"));
            r->setStatusCode(k200OK);
            return cb(r);
        }

        g_users[username] = std::move(hash);
        if (!saveUsersToDiskLocked()) {
            g_users.erase(username);
            auto r = HttpResponse::newHttpJsonResponse(makeError("Falha ao salvar usuário"));
            r->setStatusCode(k500InternalServerError);
            return cb(r);
        }
    }

    auto r = HttpResponse::newHttpJsonResponse(makeMessage("Usuário criado com sucesso"));
    r->setStatusCode(k201Created);
    cb(r);
}

void AuthController::login(const HttpRequestPtr &req,
                           std::function<void (const HttpResponsePtr &)> &&cb) {
    auto json = req->getJsonObject();
    if (!json || !json->isMember("username") || !json->isMember("password")) {
        auto r = HttpResponse::newHttpJsonResponse(makeError("Dados inválidos"));
        r->setStatusCode(k400BadRequest);
        return cb(r);
    }

    std::string username = (*json)["username"].asString();
    std::string pass     = (*json)["password"].asString();

    std::string stored;
    {
        std::lock_guard<std::mutex> lock(g_users_mtx);
        if (!loadUsersFromDiskLocked()) {
            wipe(pass);
            auto r = HttpResponse::newHttpJsonResponse(makeError("Falha ao carregar usuários"));
            r->setStatusCode(k500InternalServerError);
            return cb(r);
        }
        auto it = g_users.find(username);
        if (it == g_users.end()) {
            wipe(pass);
            auto r = HttpResponse::newHttpJsonResponse(makeError("Credenciais inválidas"));
            r->setStatusCode(k401Unauthorized);
            return cb(r);
        }
        stored = it->second;
    }

    bool ok = false;
    try {
        ok = bcrypt_check(pass, stored);
    } catch (...) {
        wipe(pass);
        auto r = HttpResponse::newHttpJsonResponse(makeError("Falha na verificação"));
        r->setStatusCode(k500InternalServerError);
        return cb(r);
    }
    wipe(pass);

    if (!ok) {
        auto r = HttpResponse::newHttpJsonResponse(makeError("Credenciais inválidas"));
        r->setStatusCode(k401Unauthorized);
        return cb(r);
    }

    // Gera token
    const auto token = issueJwtFor(username);

    // JSON + Cookie HttpOnly (+ Secure só quando HTTPS pelo túnel)
    Json::Value body;
    body["token"] = token;
    body["expires_in_hours"] = 12;

    auto resp = HttpResponse::newHttpJsonResponse(body);

    drogon::Cookie c("access_token", token);
    c.setHttpOnly(true);
    c.setSecure(isHttps(req));                        // <- chave: funciona HTTP local e HTTPS via Cloudflare
    c.setPath("/");
    c.setSameSite(drogon::Cookie::SameSite::kLax);    // Lax é seguro p/ mesma origem
    c.setExpiresDate(trantor::Date::date().after(12*60*60)); // ~12h
    resp->addCookie(c);

    cb(resp);
}

void AuthController::logout(const HttpRequestPtr& req,
                            std::function<void (const HttpResponsePtr&)>&& cb) {
    auto resp = HttpResponse::newHttpJsonResponse(makeMessage("ok"));
    drogon::Cookie c("access_token", "");
    c.setHttpOnly(true);
    c.setSecure(isHttps(req));                        // manter coerente com login
    c.setPath("/");
    c.setSameSite(drogon::Cookie::SameSite::kLax);
    c.setExpiresDate(trantor::Date::date());         // expira agora
    resp->addCookie(c);
    cb(resp);
}

void AuthController::me(const HttpRequestPtr &req,
                        std::function<void (const HttpResponsePtr &)> &&cb) {
    auto tok = extractToken(req);
    if (!tok) {
        auto r = HttpResponse::newHttpJsonResponse(makeError("Sem token"));
        r->setStatusCode(k401Unauthorized);
        return cb(r);
    }

    try {
        auto dec = jwt::decode(*tok);
        auto ver = jwt::verify()
          .with_issuer("aterro_web")
          .allow_algorithm(jwt::algorithm::hs256{jwtSecret()});
        ver.verify(dec);

        Json::Value out;
        out["sub"] = dec.get_subject(); // username
        if (dec.has_expires_at()) {
            const auto tp = dec.get_expires_at();
            out["exp"] = (Json::Int64) std::chrono::duration_cast<std::chrono::seconds>(
                tp.time_since_epoch()
            ).count();
        }
        cb(HttpResponse::newHttpJsonResponse(out));
    } catch (const std::exception&) {
        auto r = HttpResponse::newHttpJsonResponse(makeError("Token inválido/expirado"));
        r->setStatusCode(k401Unauthorized);
        cb(r);
    }
}
