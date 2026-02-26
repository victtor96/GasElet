#pragma once
#include <crypt.h>
#include <cstring>
#include <stdexcept>
#include <string>
#include <cstdio>

inline std::string bcrypt_hash(const std::string& password, int cost = 12) {
    if (cost < 4 || cost > 31) throw std::invalid_argument("bcrypt cost inválido (4..31)");
    char setting_prefix[8];
    std::snprintf(setting_prefix, sizeof(setting_prefix), "$2y$%02d$", cost);
    char saltbuf[64] = {0};
    if (!crypt_gensalt_rn(setting_prefix, 0, nullptr, 0, saltbuf, sizeof(saltbuf))) {
        throw std::runtime_error("crypt_gensalt_rn falhou");
    }
    struct crypt_data data; data.initialized = 0;
    char* out = crypt_rn(password.c_str(), saltbuf, &data, sizeof(data));
    if (!out) throw std::runtime_error("crypt_rn falhou");
    return std::string(out);
}

inline bool bcrypt_check(const std::string& password, const std::string& hash) {
    struct crypt_data data; data.initialized = 0;
    char* out = crypt_rn(password.c_str(), hash.c_str(), &data, sizeof(data));
    return out && std::strcmp(out, hash.c_str()) == 0;
}
