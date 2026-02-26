#pragma once
#include <drogon/WebSocketController.h>
#include <unordered_set>
#include <mutex>
#include <iostream>

class WsChat : public drogon::WebSocketController<WsChat> {
  public:
    WsChat() = default;

    void handleNewConnection(const drogon::HttpRequestPtr &,
                             const drogon::WebSocketConnectionPtr &conn) override;

    void handleConnectionClosed(const drogon::WebSocketConnectionPtr &conn) override;

    // ↩︎ sua versão pede handleNewMessage com std::string&&
    void handleNewMessage(const drogon::WebSocketConnectionPtr &conn,
                          std::string &&message,
                          const drogon::WebSocketMessageType &type) override;

    WS_PATH_LIST_BEGIN
    WS_PATH_ADD("/ws", drogon::Get, drogon::Post, drogon::Options);
    WS_PATH_LIST_END

  private:
    std::mutex mtx_;
    std::unordered_set<drogon::WebSocketConnectionPtr> peers_;
    void broadcast(const std::string &msg);
};
