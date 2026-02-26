cmake_minimum_required(VERSION 3.14)
project(drogon-react-ws LANGUAGES CXX)

# ---------- Padrões ----------
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(THREADS_PREFER_PTHREAD_FLAG ON)

# Evita pepino com projetos antigos (ex.: alguns repos exigem policy mínima)
set(CMAKE_POLICY_VERSION_MINIMUM 3.5)

option(ENABLE_LTO "Enable Link Time Optimization in Release builds" ON)

# ---------- Dependências principais ----------
find_package(Drogon REQUIRED)        # Drogon::Drogon
find_package(OpenSSL REQUIRED)       # OpenSSL::SSL / OpenSSL::Crypto
find_package(Threads REQUIRED)

# ---------- jwt-cpp (pacote ou fallback) ----------
# Em Arch, o pacote do AUR instala cmake configs em /usr/lib/cmake
set(jwt-cpp_DIR "/usr/lib/cmake" CACHE PATH "Path to jwt-cpp cmake config")
include(FetchContent)

set(JWTCPP_OK FALSE)
find_package(jwt-cpp CONFIG QUIET)

if (TARGET jwt-cpp::jwt-cpp)
  message(STATUS "jwt-cpp: usando alvo jwt-cpp::jwt-cpp (via pacote).")
  set(JWTCPP_OK TRUE)
elseif (TARGET jwt-cpp)
  add_library(jwt-cpp::jwt-cpp ALIAS jwt-cpp)
  message(STATUS "jwt-cpp: usando alvo jwt-cpp (alias criado).")
  set(JWTCPP_OK TRUE)
endif()

if (NOT JWTCPP_OK)
  message(STATUS "jwt-cpp não encontrado via pacote; baixando com FetchContent…")
  FetchContent_Declare(jwt-cpp
    GIT_REPOSITORY https://github.com/Thalhammer/jwt-cpp.git
    GIT_TAG v0.7.1
  )
  FetchContent_MakeAvailable(jwt-cpp)
endif()

# ---------- Alvo do servidor ----------
add_executable(${PROJECT_NAME}
  main.cpp
  controllers/wschat.cpp
  controllers/AuthController.cpp
  controllers/UserDashboard.cpp
  filters/AuthFilter.cpp



)

# Inclui diretórios locais (ex.: include/ com helpers do bcrypt via libxcrypt)
target_include_directories(${PROJECT_NAME}
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/../include
)

# Linka tudo; bcrypt via libxcrypt (crypt)
target_link_libraries(${PROJECT_NAME}
  PRIVATE
    Drogon::Drogon
    OpenSSL::SSL
    OpenSSL::Crypto
    Threads::Threads
    jwt-cpp::jwt-cpp
    crypt
)

# ---------- Warnings / Otimizações ----------
if (CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(${PROJECT_NAME} PRIVATE -Wall -Wextra -Wpedantic)
  if (CMAKE_BUILD_TYPE STREQUAL "Release")
    target_compile_options(${PROJECT_NAME} PRIVATE -O3)
    target_link_options(${PROJECT_NAME} PRIVATE -s)
  else()
    target_compile_options(${PROJECT_NAME} PRIVATE -O0 -g)
    target_link_options(${PROJECT_NAME} PRIVATE -rdynamic)
  endif()
endif()

# ---------- LTO (opcional) ----------
if (ENABLE_LTO AND CMAKE_BUILD_TYPE STREQUAL "Release")
  include(CheckIPOSupported)
  check_ipo_supported(RESULT lto_ok)
  if (lto_ok)
    set_property(TARGET ${PROJECT_NAME} PROPERTY INTERPROCEDURAL_OPTIMIZATION TRUE)
    message(STATUS "LTO habilitado para ${PROJECT_NAME}")
  endif()
endif()
