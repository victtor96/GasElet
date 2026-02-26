#include "wschat.h"                // use exatamente o mesmo case do arquivo
#include <json/json.h>
#include <trantor/utils/Date.h>

using drogon::WebSocketConnectionPtr;

void WsChat::handleNewConnection(const drogon::HttpRequestPtr &,
                                 const WebSocketConnectionPtr &conn) {
    std::lock_guard<std::mutex> lock(mtx_);
    peers_.insert(conn);

    Json::Value hello;
    hello["type"] = "welcome";
    hello["message"] = "connected";
    conn->send(hello.toStyledString());
}

void WsChat::handleConnectionClosed(const WebSocketConnectionPtr &conn) {
    std::lock_guard<std::mutex> lock(mtx_);
    peers_.erase(conn);
}

void WsChat::handleNewMessage(const WebSocketConnectionPtr &conn,
                              std::string &&message,
                              const drogon::WebSocketMessageType &type) {
    if (type == drogon::WebSocketMessageType::Text) {
        Json::CharReaderBuilder b;
        Json::Value root;
        std::string errs;
        std::unique_ptr<Json::CharReader> reader(b.newCharReader());
        if (reader->parse(message.data(), message.data() + message.size(), &root, &errs)) {
            const auto msgType = root.get("type","").asString();
                    std::cout << '\n' << message.data() << std::endl;

            if (msgType == "ping") {
                Json::Value pong;
                pong["type"] = "pong";
                pong["ts"] = (Json::Int64)trantor::Date::now().microSecondsSinceEpoch();
                conn->send(pong.toStyledString());
                return;
            }
            if (msgType == "chat") {
                Json::Value out;
                out["type"] = "chat";
                out["text"] = root.get("text","").asString();
                broadcast(out.toStyledString());
                return;
            }
        } else {
            // se não for JSON, ecoa como texto
            broadcast(message);
        }
    } else if (type == drogon::WebSocketMessageType::Binary) {
        // eco binário
        conn->send(message);
    }
}





void WsChat::broadcast(const std::string &msg) {
    std::lock_guard<std::mutex> lock(mtx_);
    for (auto &p : peers_) {
        if (p && p->connected()) p->send(msg);
    }
}
