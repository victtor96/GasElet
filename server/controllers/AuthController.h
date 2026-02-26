#pragma once
#include <drogon/HttpController.h>

class AuthController : public drogon::HttpController<AuthController> {
public:
    METHOD_LIST_BEGIN
      // Rotas públicas
      ADD_METHOD_TO(AuthController::signup, "/signup", drogon::Post); // POST /signup
      ADD_METHOD_TO(AuthController::login,  "/login",  drogon::Post); // POST /login
      // Ex.: rota para checar token/cookie rapidamente
      ADD_METHOD_TO(AuthController::me,     "/me",     drogon::Get);  // GET /me
      ADD_METHOD_TO(AuthController::logout, "/logout", drogon::Post);

    METHOD_LIST_END
    void logout(const drogon::HttpRequestPtr&,
            std::function<void (const drogon::HttpResponsePtr&)>&&);
            
    void signup(const drogon::HttpRequestPtr&,
                std::function<void (const drogon::HttpResponsePtr&)>&&);

    void login(const drogon::HttpRequestPtr&,
               std::function<void (const drogon::HttpResponsePtr&)>&&);

    void me(const drogon::HttpRequestPtr&,
            std::function<void (const drogon::HttpResponsePtr&)>&&);

private:
    // Helpers
    std::string jwtSecret() const;
    std::string issueJwtFor(const std::string& email) const;
};
