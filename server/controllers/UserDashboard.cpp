#include "UserDashboard.h"
#include <drogon/drogon.h>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <map>
#include <string>
#include <unordered_map>

using namespace drogon;

namespace {
    constexpr int kDefaultAnoInicial = 2000;
    constexpr int kDefaultAnoFinal = 2060;

    constexpr double kDefaultTaxaColetaPct = 100.0;
    constexpr double kDefaultGeracaoKgAnoHab = 328.3;
    constexpr double kDefaultKMetano = 0.05;
    constexpr double kDefaultCaptacaoBiogasPct = 100.0;

    constexpr double kDocf = 0.5;
    constexpr double kMethaneFraction = 0.5;
    constexpr double kTonPerM3Methane = 0.0007168;  // t CH4 / m3 CH4

    struct RegionCoeff {
        double a;
        double b;
    };

    const std::unordered_map<std::string, RegionCoeff> kRegionCoeffs = {
        {"Norte", {-7753.0, 4.0}},
        {"Nordeste", {-4588.33, 2.44}},
        {"Centro-Oeste", {1258.333, -0.444}},
        {"Sudeste", {-10093.667, 5.222}},
        {"Sul", {-3985.333, 2.111}},
    };

    struct Composition {
        double papel = 17.1;
        double organica = 44.9;
        double plastico = 10.8;
        double texteis = 2.6;
        double madeira = 4.7;
        double metal = 2.9;
        double vidro = 3.3;
        double borracha = 0.7;
        double outros = 13.0;
    };

    std::filesystem::path userJsonPath(const std::string& username)
    {
        std::filesystem::path base = "Dados/users";
        std::filesystem::create_directories(base);
        return base / (username + ".json");
    }

    double parseJsonNumber(const Json::Value& value, double fallback = 0.0)
    {
        if (value.isDouble() || value.isInt() || value.isUInt() || value.isInt64() || value.isUInt64())
        {
            return value.asDouble();
        }

        if (value.isString())
        {
            auto s = value.asString();
            std::replace(s.begin(), s.end(), ',', '.');
            try
            {
                size_t pos = 0;
                const double v = std::stod(s, &pos);
                if (pos > 0) return v;
            }
            catch (...) {}
        }

        return fallback;
    }

    int parseJsonInt(const Json::Value& value, int fallback = 0)
    {
        if (value.isInt() || value.isUInt() || value.isInt64() || value.isUInt64())
        {
            return value.asInt();
        }

        if (value.isDouble())
        {
            return static_cast<int>(std::llround(value.asDouble()));
        }

        if (value.isString())
        {
            auto s = value.asString();
            std::replace(s.begin(), s.end(), ',', '.');
            try
            {
                size_t pos = 0;
                const double v = std::stod(s, &pos);
                if (pos > 0) return static_cast<int>(std::llround(v));
            }
            catch (...) {}
        }

        return fallback;
    }

    Json::Value loadUserDashboard(const std::string& username)
    {
        auto path = userJsonPath(username);
        if (!std::filesystem::exists(path))
        {
            Json::Value root;
            root["username"] = username;
            root["name"] = username;
            root["role"] = "Operador";
            root["scenarios"] = Json::arrayValue;
            return root;
        }

        std::ifstream ifs(path);
        Json::Value root;
        ifs >> root;
        return root;
    }

    void saveUserDashboardJson(const std::string& username,
                               const Json::Value& root)
    {
        auto path = userJsonPath(username);
        std::ofstream ofs(path);
        ofs << root;
    }

    Json::Value mergeDashboardPayload(const std::string& username,
                                      const Json::Value& incoming,
                                      const Json::Value& existing)
    {
        Json::Value merged = existing.isObject() ? existing : Json::Value(Json::objectValue);

        merged["username"] = username;

        if (incoming.isMember("name")) {
            merged["name"] = incoming["name"];
        }

        if (incoming.isMember("role")) {
            merged["role"] = incoming["role"];
        }

        if (incoming.isMember("scenarios") && incoming["scenarios"].isArray()) {
            merged["scenarios"] = incoming["scenarios"];
        }

        if (incoming.isMember("rsuByScenario") && incoming["rsuByScenario"].isObject()) {
            merged["rsuByScenario"] = incoming["rsuByScenario"];
        }

        if (incoming.isMember("currentScenarioId")) {
            merged["currentScenarioId"] = incoming["currentScenarioId"];
        }

        return merged;
    }

    double getPerCapKgByRegionYear(const std::string& regiao, int ano, double fallbackKgAnoHab)
    {
        const auto it = kRegionCoeffs.find(regiao);
        if (it == kRegionCoeffs.end()) return fallbackKgAnoHab;
        return it->second.a + it->second.b * static_cast<double>(ano);
    }

    double calcRsuTonAno(const std::string& regiao,
                         double taxaColetaPct,
                         int ano,
                         double populacao,
                         double fallbackKgAnoHab)
    {
        const double perCapKgAnoHab = getPerCapKgByRegionYear(regiao, ano, fallbackKgAnoHab);
        const double coleta = taxaColetaPct / 100.0;
        const double rtuKgAno = coleta * perCapKgAnoHab * populacao;
        return rtuKgAno / 1000.0;
    }

    Composition parseComposition(const Json::Value& config)
    {
        Composition c;
        const auto& raw = config["composicao"];
        if (!raw.isObject()) return c;

        c.papel = parseJsonNumber(raw["papel"], c.papel);
        c.organica = parseJsonNumber(raw["organica"], c.organica);
        c.plastico = parseJsonNumber(raw["plastico"], c.plastico);
        c.texteis = parseJsonNumber(raw["texteis"], c.texteis);
        c.madeira = parseJsonNumber(raw["madeira"], c.madeira);
        c.metal = parseJsonNumber(raw["metal"], c.metal);
        c.vidro = parseJsonNumber(raw["vidro"], c.vidro);
        c.borracha = parseJsonNumber(raw["borracha"], c.borracha);
        c.outros = parseJsonNumber(raw["outros"], c.outros);
        return c;
    }

    double resolveMCF(const Json::Value& config)
    {
        if (config.isMember("mcf"))
        {
            const double mcf = parseJsonNumber(config["mcf"], 1.0);
            return std::max(0.0, mcf);
        }

        // MCF (IPCC 2006, Vol. 5, Tab. 3.1). "Parcial" e "Não gerenciado" são
        // rótulos antigos, mantidos para cenários já salvos.
        const std::string gerenciamento = config.get("gerenciamento", "").asString();
        if (gerenciamento == "Não gerenciado - profundo (>=5 m)" || gerenciamento == "Parcial") return 0.8;
        if (gerenciamento == "Não gerenciado - raso (<5 m)" ||
            gerenciamento == "Não gerenciado" || gerenciamento == "Nao gerenciado") return 0.4;
        if (gerenciamento == "Não categorizado") return 0.6;
        return 1.0;
    }

    double computeDoc(const Composition& c)
    {
        return
            (c.papel / 100.0) * 0.40 +
            (c.organica / 100.0) * 0.15 +
            (c.plastico / 100.0) * 0.00 +
            (c.texteis / 100.0) * 0.24 +
            (c.madeira / 100.0) * 0.43 +
            (c.borracha / 100.0) * 0.39 +
            ((c.metal / 100.0) + (c.vidro / 100.0) + (c.outros / 100.0)) * 0.01;
    }

    double computeLoTonPerTon(const Composition& c, double mcf)
    {
        const double doc = computeDoc(c);
        return mcf * doc * kDocf * kMethaneFraction * (16.0 / 12.0);
    }

    std::map<int, double> sumScenarioPopulation(const Json::Value& scenario)
    {
        std::map<int, double> totals;
        const auto& rows = scenario["rows"];
        if (!rows.isArray()) return totals;

        for (const auto& row : rows) {
            const auto& series = row["series"];
            if (!series.isObject()) continue;
            for (const auto& yearKey : series.getMemberNames()) {
                const int year = std::atoi(yearKey.c_str());
                const double pop = parseJsonNumber(series[yearKey], 0.0);
                totals[year] += pop;
            }
        }
        return totals;
    }

    std::map<int, double> sumPopulationFromRows(const Json::Value& rows,
                                                int anoInicial,
                                                int anoFinal)
    {
        std::map<int, double> totals;
        if (!rows.isArray()) return totals;

        for (const auto& row : rows)
        {
            const auto& series = row["series"];
            if (!series.isObject()) continue;

            for (int year = anoInicial; year <= anoFinal; ++year)
            {
                const auto yearKey = std::to_string(year);
                const double pop = parseJsonNumber(series[yearKey], 0.0);
                totals[year] += pop;
            }
        }

        return totals;
    }

    std::map<int, double> computeMethaneByYear(const std::map<int, double>& residueByYear,
                                               int anoInicial,
                                               int anoFinal,
                                               int maxYear,
                                               double kMetano,
                                               double loTonPerTon)
    {
        std::map<int, double> out;
        if (anoFinal < anoInicial) anoFinal = anoInicial;
        if (maxYear < anoFinal) maxYear = anoFinal;

        for (int year = anoInicial; year <= maxYear; ++year)
        {
            out[year] = 0.0;
        }

        for (int year = anoInicial; year <= anoFinal; ++year)
        {
            const auto it = residueByYear.find(year);
            const double residue = (it != residueByYear.end()) ? it->second : 0.0;

            for (int targetYear = year; targetYear <= maxYear; ++targetYear)
            {
                const double emission =
                    residue * kMetano * loTonPerTon *
                    std::exp(-kMetano * static_cast<double>(targetYear - year));
                out[targetYear] += emission;
            }
        }

        return out;
    }

    Json::Value toYearObject(const std::map<int, double>& values,
                             int fromYear,
                             int toYear)
    {
        Json::Value out(Json::objectValue);
        for (int year = fromYear; year <= toYear; ++year)
        {
            const auto it = values.find(year);
            out[std::to_string(year)] = (it != values.end()) ? it->second : 0.0;
        }
        return out;
    }

    Json::Value computeRsuSeries(const Json::Value& config,
                                 const std::map<int, double>& totals)
    {
        int vidaInicio = parseJsonInt(config["vidaInicio"], kDefaultAnoInicial);
        int vidaFim = parseJsonInt(config["vidaFim"], kDefaultAnoFinal);
        if (vidaFim < vidaInicio) vidaFim = vidaInicio;

        const std::string regiao = config.get("regiao", "Nordeste").asString();
        const double perCapFallback = parseJsonNumber(config["geracaoKgAnoHab"], kDefaultGeracaoKgAnoHab);
        const double taxaColetaPct = parseJsonNumber(config["taxaColetaPct"], kDefaultTaxaColetaPct);
        const double popBase = parseJsonNumber(config["popBase"], 0.0);
        const double growthPct = parseJsonNumber(config["popCrescimentoAnualPct"], 0.0);
        const double growth = growthPct / 100.0;

        Json::Value rows(Json::arrayValue);
        for (int i = 0, year = vidaInicio; year <= vidaFim; ++year, ++i) {
            double pop = 0.0;
            auto it = totals.find(year);
            if (it != totals.end()) {
                pop = it->second;
            } else {
                pop = popBase * std::pow(1.0 + growth, i);
            }

            const double rsuTAno = calcRsuTonAno(regiao, taxaColetaPct, year, pop, perCapFallback);

            Json::Value row;
            row["ano"] = year;
            row["pop"] = pop;
            row["rsuTAno"] = rsuTAno;
            row["source"] = it != totals.end() ? "scenario" : "model";
            rows.append(row);
        }

        return rows;
    }

    Json::Value computeLandfillCalculation(const Json::Value& config,
                                           const Json::Value& rows,
                                           int anoInicial,
                                           int anoFinal,
                                           int maxYear)
    {
        if (anoFinal < anoInicial) anoFinal = anoInicial;
        if (maxYear < anoFinal) maxYear = anoFinal;

        const std::string regiao = config.get("regiao", "Nordeste").asString();
        const double taxaColetaPct = parseJsonNumber(config["taxaColetaPct"], kDefaultTaxaColetaPct);
        const double perCapFallback = parseJsonNumber(config["geracaoKgAnoHab"], kDefaultGeracaoKgAnoHab);
        const double popBase = parseJsonNumber(config["popBase"], 0.0);
        const double growthPct = parseJsonNumber(config["popCrescimentoAnualPct"], 0.0);
        const double growth = growthPct / 100.0;
        const double kMetano = parseJsonNumber(config["kMetano"], kDefaultKMetano);
        const double captacao = std::clamp(
            parseJsonNumber(config["captacaoBiogasPct"], kDefaultCaptacaoBiogasPct), 0.0, 100.0) / 100.0;

        const Composition comp = parseComposition(config);
        const double mcf = resolveMCF(config);
        const double doc = computeDoc(comp);
        const double loTonPerTon = computeLoTonPerTon(comp, mcf);
        const double loM3PerTon = (kTonPerM3Methane > 0.0) ? (loTonPerTon / kTonPerM3Methane) : 0.0;

        const auto totalPopByYear = sumPopulationFromRows(rows, anoInicial, maxYear);
        std::map<int, double> totalResidueByYear;

        Json::Value totalRows(Json::arrayValue);
        for (int i = 0, year = anoInicial; year <= maxYear; ++year, ++i)
        {
            const auto it = totalPopByYear.find(year);
            const bool fromScenario = it != totalPopByYear.end() && it->second > 0.0;
            const double pop = fromScenario ? it->second : (popBase * std::pow(1.0 + growth, i));
            const bool aterroAberto = year <= anoFinal;
            const double residue = aterroAberto
                ? calcRsuTonAno(regiao, taxaColetaPct, year, pop, perCapFallback)
                : 0.0;
            totalResidueByYear[year] = residue;

            Json::Value rowOut;
            rowOut["ano"] = year;
            rowOut["pop"] = pop;
            rowOut["residuoTAno"] = residue;
            if (!aterroAberto) {
                rowOut["source"] = "closed";
            } else {
                rowOut["source"] = fromScenario ? "scenario" : "model";
            }
            totalRows.append(rowOut);
        }

        const auto totalMethaneByYear = computeMethaneByYear(
            totalResidueByYear,
            anoInicial,
            anoFinal,
            maxYear,
            kMetano,
            loTonPerTon);

        for (Json::ArrayIndex i = 0; i < totalRows.size(); ++i)
        {
            const int year = totalRows[i]["ano"].asInt();
            auto it = totalMethaneByYear.find(year);
            const double metano = (it != totalMethaneByYear.end()) ? it->second : 0.0;
            totalRows[i]["metanoTAno"] = metano;
            totalRows[i]["metanoRecuperadoTAno"] = metano * captacao;
        }

        Json::Value cities(Json::arrayValue);
        for (const auto& city : rows)
        {
            const std::string uf = city.get("uf", "").asString();
            const std::string nome = city.get("nome", "").asString();
            if (uf.empty() || nome.empty()) continue;

            const std::string key = uf + "::" + nome;
            const auto& series = city["series"];
            if (!series.isObject()) continue;

            std::map<int, double> cityResidueByYear;
            Json::Value cityRows(Json::arrayValue);

            for (int year = anoInicial; year <= maxYear; ++year)
            {
                const auto yearKey = std::to_string(year);
                const double pop = parseJsonNumber(series[yearKey], 0.0);
                const bool aterroAberto = year <= anoFinal;
                const double residue = aterroAberto
                    ? calcRsuTonAno(regiao, taxaColetaPct, year, pop, perCapFallback)
                    : 0.0;
                cityResidueByYear[year] = residue;

                Json::Value rowOut;
                rowOut["ano"] = year;
                rowOut["pop"] = pop;
                rowOut["residuoTAno"] = residue;
                rowOut["source"] = aterroAberto ? "scenario" : "closed";
                cityRows.append(rowOut);
            }

            const auto cityMethaneByYear = computeMethaneByYear(
                cityResidueByYear,
                anoInicial,
                anoFinal,
                maxYear,
                kMetano,
                loTonPerTon);

            for (Json::ArrayIndex i = 0; i < cityRows.size(); ++i)
            {
                const int year = cityRows[i]["ano"].asInt();
                auto it = cityMethaneByYear.find(year);
                const double metano = (it != cityMethaneByYear.end()) ? it->second : 0.0;
                cityRows[i]["metanoTAno"] = metano;
                cityRows[i]["metanoRecuperadoTAno"] = metano * captacao;
            }

            Json::Value cityOut;
            cityOut["key"] = key;
            cityOut["uf"] = uf;
            cityOut["nome"] = nome;
            cityOut["rows"] = cityRows;
            cityOut["methaneByYear"] = toYearObject(cityMethaneByYear, anoInicial, maxYear);
            cities.append(cityOut);
        }

        Json::Value out(Json::objectValue);
        out["anoInicial"] = anoInicial;
        out["anoFinal"] = anoFinal;
        out["maxYear"] = maxYear;
        out["kMetano"] = kMetano;
        out["doc"] = doc;
        out["mcf"] = mcf;
        out["captacaoBiogasPct"] = captacao * 100.0;
        out["loTonPerTon"] = loTonPerTon;
        out["loM3PerTon"] = loM3PerTon;
        out["total"]["rows"] = totalRows;
        out["total"]["methaneByYear"] = toYearObject(totalMethaneByYear, anoInicial, maxYear);
        out["cities"] = cities;
        return out;
    }

    void applyRsuEquation(Json::Value& root)
    {
        const auto& scenarios = root["scenarios"];
        auto& rsuByScenario = root["rsuByScenario"];
        if (!scenarios.isArray() || !rsuByScenario.isObject()) return;

        std::unordered_map<std::string, std::map<int, double>> totalsByScenario;
        std::unordered_map<std::string, Json::Value> rowsByScenario;
        for (const auto& scenario : scenarios) {
            const std::string id = scenario.get("id", "").asString();
            if (id.empty()) continue;
            totalsByScenario[id] = sumScenarioPopulation(scenario);
            rowsByScenario[id] = scenario["rows"];
        }

        const Json::Value emptyRows(Json::arrayValue);

        for (const auto& id : rsuByScenario.getMemberNames()) {
            auto& entry = rsuByScenario[id];
            const auto& config = entry["config"];
            if (!config.isObject()) continue;

            const auto it = totalsByScenario.find(id);
            const std::map<int, double> emptyTotals;
            const auto& totals = (it != totalsByScenario.end()) ? it->second : emptyTotals;
            entry["series"] = computeRsuSeries(config, totals);

            const int anoInicial = parseJsonInt(config["vidaInicio"], kDefaultAnoInicial);
            const int anoFinal = parseJsonInt(config["vidaFim"], kDefaultAnoFinal);
            const auto rowsIt = rowsByScenario.find(id);
            const auto& scenarioRows = (rowsIt != rowsByScenario.end()) ? rowsIt->second : emptyRows;

            entry["landfillCalc"] = computeLandfillCalculation(
                config,
                scenarioRows,
                anoInicial,
                std::max(anoInicial, anoFinal),
                std::max(anoInicial, kDefaultAnoFinal));
        }
    }
}

void UserDashboard::getDashboard(const HttpRequestPtr& req,
                                 std::function<void (const HttpResponsePtr&)>&& cb)
{
    try {
        const auto &username = req->attributes()->get<std::string>("username");

        auto data = loadUserDashboard(username);
        applyRsuEquation(data);
        auto resp = HttpResponse::newHttpJsonResponse(data);
        cb(resp);
    } catch (const std::exception& e) {
        LOG_ERROR << "UserDashboard::getDashboard erro: " << e.what();
        auto resp = HttpResponse::newHttpResponse();
        resp->setStatusCode(k500InternalServerError);
        resp->setBody("Erro ao carregar dashboard do usuário");
        cb(resp);
    }
}

void UserDashboard::saveDashboard(const HttpRequestPtr& req,
                                  std::function<void (const HttpResponsePtr&)>&& cb)
{
    try {
        const auto &username = req->attributes()->get<std::string>("username");

        auto jsonOpt = req->getJsonObject();
        if (!jsonOpt) {
            auto resp = HttpResponse::newHttpResponse();
            resp->setStatusCode(k400BadRequest);
            resp->setBody("JSON inválido");
            return cb(resp);
        }

        Json::Value incoming = *jsonOpt;
        const auto existing = loadUserDashboard(username);
        auto merged = mergeDashboardPayload(username, incoming, existing);
        applyRsuEquation(merged);

        saveUserDashboardJson(username, merged);

        Json::Value ok;
        ok["status"] = "ok";
        ok["message"] = "Dashboard salvo com sucesso";

        auto resp = HttpResponse::newHttpJsonResponse(ok);
        cb(resp);
    } catch (const std::exception& e) {
        LOG_ERROR << "UserDashboard::saveDashboard erro: " << e.what();
        auto resp = HttpResponse::newHttpResponse();
        resp->setStatusCode(k500InternalServerError);
        resp->setBody("Erro ao salvar dashboard do usuário");
        cb(resp);
    }
}

void UserDashboard::calculateLandfill(const HttpRequestPtr& req,
                                      std::function<void (const HttpResponsePtr&)>&& cb)
{
    try
    {
        auto jsonOpt = req->getJsonObject();
        if (!jsonOpt)
        {
            auto resp = HttpResponse::newHttpResponse();
            resp->setStatusCode(k400BadRequest);
            resp->setBody("JSON inválido");
            return cb(resp);
        }

        const Json::Value payload = *jsonOpt;
        const Json::Value config = payload["config"].isObject() ? payload["config"] : Json::Value(Json::objectValue);
        const Json::Value rows = payload["rows"].isArray() ? payload["rows"] : Json::Value(Json::arrayValue);

        const int anoInicial = parseJsonInt(
            payload["anoInicial"],
            parseJsonInt(config["vidaInicio"], kDefaultAnoInicial));
        const int anoFinal = parseJsonInt(
            payload["anoFinal"],
            parseJsonInt(config["vidaFim"], kDefaultAnoFinal));
        const int maxYear = parseJsonInt(payload["maxYear"], kDefaultAnoFinal);

        auto result = computeLandfillCalculation(
            config,
            rows,
            anoInicial,
            std::max(anoInicial, anoFinal),
            std::max(anoInicial, maxYear));
        result["status"] = "ok";

        auto resp = HttpResponse::newHttpJsonResponse(result);
        cb(resp);
    }
    catch (const std::exception& e)
    {
        LOG_ERROR << "UserDashboard::calculateLandfill erro: " << e.what();
        auto resp = HttpResponse::newHttpResponse();
        resp->setStatusCode(k500InternalServerError);
        resp->setBody("Erro ao calcular metano/LO no servidor");
        cb(resp);
    }
}
