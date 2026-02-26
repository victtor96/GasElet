#pragma once
#include <drogon/HttpFilter.h>

// Filtro que garante que a request está autenticada
// e injeta "username" em req->attributes()
class AuthFilter : public drogon::HttpFilter<AuthFilter>
{
  public:
    AuthFilter() = default;
    void doFilter(const drogon::HttpRequestPtr& req,
                  drogon::FilterCallback&& fcb,
                  drogon::FilterChainCallback&& fccb) override;
};
