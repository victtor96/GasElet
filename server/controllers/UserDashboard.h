#pragma once
#include <drogon/HttpController.h>

class UserDashboard : public drogon::HttpController<UserDashboard>
{
  public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(UserDashboard::getDashboard,
                  "/api/user/dashboard", drogon::Get, "AuthFilter");
    ADD_METHOD_TO(UserDashboard::saveDashboard,
                  "/api/user/dashboard", drogon::Post, "AuthFilter");
    ADD_METHOD_TO(UserDashboard::calculateLandfill,
                  "/api/user/landfill/calc", drogon::Post, "AuthFilter");
    METHOD_LIST_END

    void getDashboard(const drogon::HttpRequestPtr& req,
                      std::function<void (const drogon::HttpResponsePtr&)>&& cb);

    void saveDashboard(const drogon::HttpRequestPtr& req,
                       std::function<void (const drogon::HttpResponsePtr&)>&& cb);

    void calculateLandfill(const drogon::HttpRequestPtr& req,
                           std::function<void (const drogon::HttpResponsePtr&)>&& cb);
};
