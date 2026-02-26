#include "AuthFilter.h"
#include <drogon/drogon.h>
#include <jwt-cpp/jwt.h>
#include <optional>
#include <algorithm>
#include <cstdlib>

using namespace drogon;

// ======= helpers internos, compatíveis com AuthController =======

// mesmo cookie e header que você usa no AuthController
static std::optional<std::string> extractToken(const HttpRequestPtr& req)
{
    // 1) Authorization: Bearer xxx
    auto auth = req->getHeader("Authorization");
    if (!auth.empty())
    {
        const std::string prefix = "Bearer ";
        if (auth.size() > prefix.size() && auth.rfind(prefix, 0) == 0)
        {
            return auth.substr(prefix.size());
        }
    }

    // 2) Cookie access_token
    auto c = req->getCookie("access_token");
    if (!c.empty())
        return c;

    return std::nullopt;
}

// mesma lógica de jwtSecret() do AuthController
static std::string jwtSecret()
{
    const char* env = std::getenv("JWT_SECRET");
    if (env && *env)
        return std::string(env);
    // fallback dev (trocar em produção)
    return "dev-secret-change-me";
}

void AuthFilter::doFilter(const HttpRequestPtr& req,
                          FilterCallback&& fcb,
                          FilterChainCallback&& fccb)
{
    auto tok = extractToken(req);
    if (!tok)
    {
        auto resp = HttpResponse::newHttpResponse();
        resp->setStatusCode(k401Unauthorized);
        resp->setBody("Sem token");
        return fcb(resp);
    }

    try
    {
        auto dec = jwt::decode(*tok);

        auto ver = jwt::verify()
            .with_issuer("aterro_web")  // mesmo issuer do AuthController
            .allow_algorithm(jwt::algorithm::hs256{jwtSecret()});

        ver.verify(dec);

        // username está em "sub" (subject)
        std::string username = dec.get_subject();
        if (username.empty())
        {
            auto resp = HttpResponse::newHttpResponse();
            resp->setStatusCode(k401Unauthorized);
            resp->setBody("Token sem subject");
            return fcb(resp);
        }

        // injeta username na request para os controllers usarem
        req->attributes()->insert("username", username);

        // ok, segue para o controller protegido
        fccb();
    }
    catch (const std::exception& e)
    {
        LOG_WARN << "AuthFilter error: " << e.what();
        auto resp = HttpResponse::newHttpResponse();
        resp->setStatusCode(k401Unauthorized);
        resp->setBody("Token inválido/expirado");
        return fcb(resp);
    }
}
