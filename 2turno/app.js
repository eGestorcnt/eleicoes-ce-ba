/* Painel PÚBLICO do 2º turno de Presidente (eleição 6258, 25/10/2026).
 *
 * Cada visitante lê os arquivos oficiais direto do TSE (o CDN do TSE libera CORS e guarda
 * cópia por ~60 s), a cada 60 s. Não há servidor nosso: a página é estática.
 * As contas são as mesmas de ../monitor.py (o teste testes_monitor_2turno.py confere as duas):
 *   abstenção e comparecimento só das seções totalizadas (a = est − c);
 *   aptos ainda por apurar = te − est (OFICIAL); votos por vir = isso × c/est (ESTIMATIVA);
 *   projeção do Brasil = soma das projeções das 27 UFs + exterior.
 * Sem parâmetro "nocache" na URL, de propósito: respeita o cache do CDN do TSE.
 */
"use strict";

var NUCLEO = (function () {
  var UFS = ["ac", "al", "am", "ap", "ba", "ce", "df", "es", "go", "ma", "mg", "ms", "mt", "pa", "pb",
             "pe", "pi", "pr", "rj", "rn", "ro", "rr", "rs", "sc", "se", "sp", "to"];
  var EXTERIOR = "zz";
  var PARTES = UFS.concat([EXTERIOR]);
  var ARQUIVOS = ["br"].concat(PARTES);

  function inteiro(x) {
    var n = parseInt(String(x == null ? "0" : x).trim() || "0", 10);
    return isNaN(n) ? 0 : n;
  }

  function extrai(j) {
    var s = j.s || {}, e = j.e || {}, v = j.v || {};
    var cands = [];
    j.carg[0].agr.forEach(function (a) {
      a.par.forEach(function (p) {
        p.cand.forEach(function (c) {
          cands.push({ seq: inteiro(c.seq) || 99, nm: c.nmu, vap: inteiro(c.vap), st: c.st || "",
                       n: c.n || "", sq: c.sqcand || "" });
        });
      });
    });
    cands.sort(function (x, y) { return x.seq - y.seq || (x.nm < y.nm ? -1 : 1); });
    var d = { abr: j.cdabr || "", dg: j.dg || "", hg: j.hg || "",
              ts: inteiro(s.ts), st: inteiro(s.st), te: inteiro(e.te), est: inteiro(e.est),
              esnt: inteiro(e.esnt), c: inteiro(e.c), a: inteiro(e.a), tv: inteiro(v.tv), vv: inteiro(v.vv),
              vb: inteiro(v.vb), tvn: inteiro(v.tvn), ordem: [], votos: {}, situacao: {}, numero: {}, sq: {} };
    cands.forEach(function (c) {
      d.ordem.push(c.nm); d.votos[c.nm] = c.vap; d.situacao[c.nm] = c.st; d.numero[c.nm] = c.n; d.sq[c.nm] = c.sq;
    });
    return d;
  }

  function pct(a, b) { return b ? 100 * a / b : 0; }

  function lider(votos) {
    var nomes = Object.keys(votos || {});
    if (!nomes.length || !nomes.some(function (k) { return votos[k]; })) return "";
    nomes.sort(function (x, y) { return votos[y] - votos[x]; });
    if (nomes.length > 1 && votos[nomes[0]] === votos[nomes[1]]) return "EMPATE";
    return nomes[0];
  }

  function referencia(d) {
    var ref = {};
    if (!d) return ref;
    if (d.est) ref.taxa = d.c / d.est;
    if (d.tv) ref.val = d.vv / d.tv;
    if (d.vv) { ref.div = {}; d.ordem.forEach(function (nm) { ref.div[nm] = d.votos[nm] / d.vv; }); }
    return ref;
  }

  function calcula(d, ref) {
    ref = ref || {};
    var r = Object.assign({}, d);
    r.pct_sec = pct(d.st, d.ts); r.pct_eleit = pct(d.est, d.te);
    r.pct_comp = pct(d.c, d.est); r.pct_abst = pct(d.a, d.est);
    r.pct_cand = {}; d.ordem.forEach(function (nm) { r.pct_cand[nm] = pct(d.votos[nm], d.vv); });
    r.lider = lider(d.votos);
    r.por_apurar = Math.max(d.te - d.est, 0);
    var taxa = null;
    if (d.est) { taxa = d.c / d.est; r.base_taxa = "UF"; }
    else if ("taxa" in ref) { taxa = ref.taxa; r.base_taxa = "BRASIL"; }
    else r.base_taxa = "";
    var val = d.tv ? d.vv / d.tv : ref.val;
    var div = null;
    if (d.vv) { div = {}; d.ordem.forEach(function (nm) { div[nm] = d.votos[nm] / d.vv; }); }
    else if (ref.div) div = ref.div;
    r.por_vir = null; r.proj = null; r.proj_validos = null;
    if (taxa !== null) {
      r.por_vir = r.por_apurar * taxa;
      if (val != null && div) {
        var vir = r.por_vir * val;
        r.proj_validos = d.vv + vir;
        r.proj = {};
        d.ordem.forEach(function (nm) { r.proj[nm] = (d.votos[nm] || 0) + vir * (div[nm] || 0); });
      }
    }
    return r;
  }

  function somaProjecao(linhas) {
    var t = { proj: {}, proj_validos: 0, por_vir: 0, por_apurar: 0, faltam: [] };
    PARTES.forEach(function (uf) {
      var r = linhas[uf];
      if (!r) { t.faltam.push(uf); return; }
      t.por_apurar += r.por_apurar;
      if (!r.proj) { t.faltam.push(uf); return; }
      t.por_vir += r.por_vir; t.proj_validos += r.proj_validos;
      Object.keys(r.proj).forEach(function (nm) { t.proj[nm] = (t.proj[nm] || 0) + r.proj[nm]; });
    });
    if (t.faltam.length) t.proj = null;
    return t;
  }

  var CONFERE = [["Seções totais", "ts"], ["Seções totalizadas", "st"], ["Eleitores aptos", "te"],
                 ["Eleitorado das seções totalizadas", "est"], ["Compareceram", "c"], ["Abstenção", "a"],
                 ["Votos apurados", "tv"], ["Válidos", "vv"], ["Brancos", "vb"], ["Nulos", "tvn"]];

  function conferencia(dBr, partes) {
    var faltam = PARTES.filter(function (u) { return !partes[u]; });
    if (!dBr || faltam.length) {
      var motivo = faltam.length ? "falta a leitura de " + faltam.map(function (u) { return u.toUpperCase(); }).join(", ")
                                 : "falta o arquivo br";
      return [["Conferência", null, null, "NÃO VERIFICÁVEL — " + motivo]];
    }
    var saida = CONFERE.map(function (it) {
      var vs = PARTES.reduce(function (s, u) { return s + partes[u][it[1]]; }, 0);
      return [it[0], dBr[it[1]], vs, dBr[it[1]] === vs ? "OK" : "DIVERGENTE"];
    });
    dBr.ordem.forEach(function (nm) {
      var vs = PARTES.reduce(function (s, u) { return s + (partes[u].votos[nm] || 0); }, 0);
      saida.push([nm, dBr.votos[nm], vs, dBr.votos[nm] === vs ? "OK" : "DIVERGENTE"]);
    });
    return saida;
  }

  function monta(ultimo) {
    var dados = {};
    ARQUIVOS.forEach(function (uf) { dados[uf] = (ultimo[uf] || {}).dados || null; });
    var ref = referencia(dados.br), linhas = {}, partes = {};
    PARTES.forEach(function (uf) { linhas[uf] = dados[uf] ? calcula(dados[uf], ref) : null; partes[uf] = dados[uf]; });
    var base = dados.br || ARQUIVOS.map(function (u) { return dados[u]; }).filter(Boolean)[0] || { ordem: [] };
    var leitura = {};
    ARQUIVOS.forEach(function (uf) {
      var u = ultimo[uf] || {};
      leitura[uf] = { lido_em: u.lido_em || "", falha: u.falha || "" };
    });
    return { br: dados.br ? calcula(dados.br, ref) : null, linhas: linhas, ordem: base.ordem,
             proj_br: somaProjecao(linhas), conf: conferencia(dados.br, partes), leitura: leitura };
  }

  return { UFS: UFS, EXTERIOR: EXTERIOR, PARTES: PARTES, ARQUIVOS: ARQUIVOS, inteiro: inteiro, extrai: extrai,
           pct: pct, lider: lider, referencia: referencia, calcula: calcula, somaProjecao: somaProjecao,
           conferencia: conferencia, monta: monta };
})();

if (typeof module !== "undefined") module.exports = NUCLEO;

if (typeof document !== "undefined") (function (N) {
  var CFG = JSON.parse(document.getElementById("config").textContent);
  var RAIZ = "https://resultados.tse.jus.br/oficial/ele2026/" + CFG.eleicao;
  var INTERVALO = 60;
  var COR = { "13": "#C62828", "22": "#1D4ED8" };
  var ultimo = {}, anterior = {}, alertas = [], alertados = {}, evolucao = [];
  var est = {}, CHAVE = "ordem2t";
  try { est = JSON.parse(sessionStorage.getItem(CHAVE) || "{}") || {}; } catch (e) { est = {}; }

  // ---- formatação
  function br(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  function brp(x) { return x.toFixed(2).replace(".", ","); }
  function esc(t) {
    return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function curto(nm) { return nm ? nm.split(" ")[0] : ""; }
  function hora(d) { return d.toTimeString().slice(0, 8); }
  function par(m) { var o = m.ordem.concat(["", ""]); return [o[0], o[1]]; }
  function cor(d, nm) { return COR[((d || {}).numero || {})[nm]] || "#475569"; }
  function marca(d, nm) { return (!nm || nm === "EMPATE") ? "" : '<span class="cor" style="background:' + cor(d, nm) + '"></span>'; }
  function band(uf) { return '<img class="band" src="bandeiras/' + uf + '.png" alt="">'; }
  function nomeLider(nm) { return nm && nm !== "EMPATE" ? curto(nm) : (nm || "—"); }
  function txtDif(votos, a, b) {
    var d = Math.round((votos[a] || 0) - (votos[b] || 0));
    if (d === 0) return Object.keys(votos).some(function (k) { return votos[k]; }) ? "EMPATE" : "—";
    return curto(d > 0 ? a : b) + " +" + br(Math.abs(d));
  }
  function tdN(v, texto, extra) {
    if (v === null || v === undefined) return '<td class="n" data-v="">—' + (extra || "") + "</td>";
    return '<td class="n" data-v="' + v.toFixed(4) + '">' + (texto !== undefined && texto !== null ? texto : br(v)) + (extra || "") + "</td>";
  }

  // ---- busca
  function decodifica(jws) {
    var meio = jws.trim().split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    while (meio.length % 4) meio += "=";
    var bin = atob(meio), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder("utf-8").decode(bytes));
  }
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function baixa(uf, tentativa) {
    tentativa = tentativa || 0;
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 20000);
    var nome = uf + "-c0001-e" + ("000000" + CFG.eleicao).slice(-6) + "-u.jws";
    return fetch(RAIZ + "/dados/" + uf + "/" + nome, { signal: ctl.signal })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (t) { return decodifica(t); })
      .finally(function () { clearTimeout(t); })
      .catch(function (e) {
        if (tentativa >= 2) throw e;
        return espera(2000 * Math.pow(2, tentativa)).then(function () { return baixa(uf, tentativa + 1); });
      });
  }
  function ciclo() {
    var agora = new Date();
    return Promise.all(N.ARQUIVOS.map(function (uf) {
      return baixa(uf).then(function (j) {
        ultimo[uf] = { dados: N.extrai(j), lido_em: hora(agora), falha: "" };
      }, function (e) {
        var ant = ultimo[uf] || {};
        ultimo[uf] = { dados: ant.dados || null, lido_em: ant.lido_em || "", falha: String(e && e.message || e) };
      });
    })).then(function () { return agora; });
  }

  // ---- registro da sessão (alertas e evolução desde que a página foi aberta)
  function registra(m, agora) {
    N.PARTES.forEach(function (uf) {
      var r = m.linhas[uf], a = anterior[uf];
      if (r && a && r.st > a.st) {
        var chave = uf + "|" + r.st + "|" + r.dg + " " + r.hg;
        if (!alertados[chave] && (!CFG.alertar.length || CFG.alertar.indexOf(uf) >= 0)) {
          alertados[chave] = 1;
          var la = N.lider(a.votos), var_ = {};
          m.ordem.forEach(function (nm) {
            var_[nm] = { votos: (r.votos[nm] || 0) - (a.votos[nm] || 0),
                         pp: (r.pct_cand[nm] || 0) - N.pct(a.votos[nm] || 0, a.vv) };
          });
          var mudou = !!(la && r.lider && la !== r.lider);
          alertas.push({ hora: hora(agora), uf: uf.toUpperCase(), novos: r.st - a.st, st: r.st, ts: r.ts,
                         vp: r.pct_sec - N.pct(a.st, a.ts), var: var_, lider: r.lider, mudou: mudou,
                         tse: r.dg + " " + r.hg });
        }
      }
      if (r) anterior[uf] = r;
    });
    var b = m.br, h = evolucao[evolucao.length - 1];
    if (b && (!h || h.st !== b.st || h.tv !== b.tv)) {
      evolucao.push({ leitura: hora(agora), hg: b.hg, st: b.st, tv: b.tv, pct_sec: b.pct_sec,
                      votos: Object.assign({}, b.votos), pct: Object.assign({}, b.pct_cand) });
    }
  }

  // ---- telas
  function situacao(m) {
    var b = m.br;
    if (!b) return "SEM LEITURA DO BRASIL";
    if (b.ts && b.st >= b.ts) return "APURAÇÃO CONCLUÍDA — 100% das seções totalizadas";
    if (!b.st) return "APURAÇÃO NÃO INICIADA — o TSE divulga a partir das 17h (Brasília)";
    return "APURAÇÃO EM ANDAMENTO";
  }
  function situacaoLeitura(info) {
    if (!info.falha) return "OK";
    if (info.lido_em) return '<span class="falha">FALHA NA LEITURA — valor anterior</span><br>sem atualização desde ' + info.lido_em;
    return '<span class="falha">FALHA NA LEITURA</span><br>sem leitura anterior';
  }
  function textoProjecao(m) {
    var pb = m.proj_br, ab = par(m);
    if (!pb.proj) return "PROJEÇÃO do Brasil: sem base ainda — nenhuma seção totalizada.";
    var tv = pb.proj_validos;
    return "PROJEÇÃO ao fim da apuração (ESTIMATIVA, soma das UFs): " + m.ordem.map(function (nm) {
      return curto(nm) + " " + br(pb.proj[nm] || 0) + " (" + brp(N.pct(pb.proj[nm] || 0, tv)) + "%)";
    }).join(" × ") + "; diferença projetada " + txtDif(pb.proj, ab[0], ab[1]) + ". Premissa: em cada UF, o eleitorado " +
      "das seções ainda não totalizadas comparece, anula e vota como nas seções já totalizadas da UF. Não é resultado.";
  }
  // bandeira e % dos estados em que o candidato lidera, do maior % para o menor (no cartão)
  function estadosNaFrente(m, nm) {
    var lista = N.UFS.filter(function (uf) { return m.linhas[uf] && m.linhas[uf].lider === nm; })
      .map(function (uf) { return [uf, m.linhas[uf].pct_cand[nm] || 0]; })
      .sort(function (x, y) { return y[1] - x[1]; });
    if (!lista.length) return '<div class="estados"><div class="rotulo">À frente em 0 estados</div></div>';
    return '<div class="estados"><div class="rotulo">À frente em ' + lista.length + " estado" + (lista.length > 1 ? "s" : "") +
      '</div><div class="lista">' + lista.map(function (it) {
        return '<span title="' + esc(CFG.nome_uf[it[0]]) + '">' + band(it[0]) + it[0].toUpperCase() + " " + brp(it[1]) + "%</span>";
      }).join("") + "</div></div>";
  }

  function painelBrasil(m) {
    var b = m.br;
    if (!b) return '<div class="cartao"><b>FALHA NA LEITURA do arquivo do Brasil.</b></div>';
    var ab = par(m);
    // quem está à frente fica sempre no primeiro cartão (empate: ordem do TSE)
    var frente = m.ordem.slice().sort(function (x, y) {
      return (b.votos[y] || 0) - (b.votos[x] || 0) || m.ordem.indexOf(x) - m.ordem.indexOf(y);
    });
    var cards = frente.map(function (nm) {
      var sq = (b.sq || {})[nm], foto = /^\d+$/.test(sq || "") ?
        '<img class="foto" src="' + RAIZ + "/fotos/br/" + sq + '.jpeg" alt="Foto de ' + esc(nm) + '">' : "";
      return '<div class="cartao cand" style="--cor:' + cor(b, nm) + '"><div class="topo-cand">' + foto +
        '<div><div class="num">Nº ' + esc(b.numero[nm]) + '</div><div class="nome">' + esc(nm) + "</div></div>" +
        estadosNaFrente(m, nm) + "</div>" +
        '<div class="pct">' + brp(b.pct_cand[nm] || 0) + '%</div><div class="votos">' + br(b.votos[nm] || 0) +
        " votos válidos</div>" + (b.situacao[nm] ? '<div class="eleito">' + esc(b.situacao[nm].toUpperCase()) + "</div>" : "") + "</div>";
    }).join("");
    var divisao;
    if (b.vv) {
      divisao = '<div class="meio"><div class="divisao">' + frente.map(function (nm) {
        return '<span style="width:' + (b.pct_cand[nm] || 0).toFixed(3) + "%;background:" + cor(b, nm) + '"></span>';
      }).join("") + '</div></div><div class="legenda">' + frente.map(function (nm) {
        return "<span>" + esc(curto(nm)) + " " + brp(b.pct_cand[nm] || 0) + "%</span>";
      }).join("") + '</div><div class="legenda"><span>Diferença: <b>' + txtDif(b.votos, ab[0], ab[1]) +
        "</b></span><span>linha tracejada = 50% dos válidos</span></div>";
    } else {
      divisao = '<div class="divisao"></div><div class="legenda"><span>Aguardando os primeiros votos</span></div>';
    }
    var apur = '<div class="cartao"><div class="rotulo">Seções totalizadas</div><div class="grande">' + brp(b.pct_sec) +
      '%</div><div class="progresso"><span style="width:' + b.pct_sec.toFixed(3) + '%"></span></div><div class="legenda"><span>' +
      br(b.st) + " de " + br(b.ts) + " seções</span><span>eleitorado totalizado " + brp(b.pct_eleit) + "%</span></div>" + divisao + "</div>";
    var kpis = [["Eleitores aptos", br(b.te), "no Brasil e no exterior"],
                ["Compareceram", br(b.c), brp(b.pct_comp) + "% nas seções totalizadas"],
                ["Abstenção", br(b.a), brp(b.pct_abst) + "% nas seções totalizadas"],
                ["Votos válidos", br(b.vv), "de " + br(b.tv) + " votos apurados"],
                ["Brancos", br(b.vb), brp(N.pct(b.vb, b.tv)) + "% dos votos"],
                ["Nulos", br(b.tvn), brp(N.pct(b.tvn, b.tv)) + "% dos votos"],
                ["Aptos ainda por apurar", br(b.por_apurar), "OFICIAL (TSE)"],
                ["Votos ainda por vir", b.por_vir === null ? "—" : br(b.por_vir), "ESTIMATIVA"]];
    return '<div class="grade">' + apur + '<div class="cands">' + cards + '</div></div><div class="kpis">' +
      kpis.map(function (k) {
        return '<div class="cartao kpi"><div class="rotulo">' + k[0] + '</div><div class="valor">' + k[1] +
          '</div><div class="sub">' + k[2] + "</div></div>";
      }).join("") + '</div><div class="cartao proj">' + esc(textoProjecao(m)) + "</div>";
  }
  function resumoPapel(m) {
    var b = m.br, ab = par(m);
    if (!b) return "";
    var c = function (t) { return '<td class="n">' + t + "</td>"; };
    return '<table class="medio" id="t-resumo"><thead><tr><th>Seções totalizadas</th><th>% eleitorado totalizado</th>' +
      "<th>Aptos</th><th>Compareceram</th><th>Abstenção</th><th>Válidos</th><th>Brancos</th><th>Nulos</th><th>" +
      esc(curto(ab[0])) + "</th><th>" + esc(curto(ab[1])) + "</th><th>Diferença</th><th>Aptos ainda por apurar (OFICIAL)</th>" +
      "<th>Votos ainda por vir (ESTIMATIVA)</th></tr></thead><tbody><tr>" +
      c(br(b.st) + " de " + br(b.ts) + "<br>" + brp(b.pct_sec) + "%") + c(brp(b.pct_eleit) + "%") + c(br(b.te)) +
      c(br(b.c) + "<br>" + brp(b.pct_comp) + "%") + c(br(b.a) + "<br>" + brp(b.pct_abst) + "%") + c(br(b.vv)) +
      c(br(b.vb)) + c(br(b.tvn)) + c(br(b.votos[ab[0]] || 0) + "<br>" + brp(b.pct_cand[ab[0]] || 0) + "%") +
      c(br(b.votos[ab[1]] || 0) + "<br>" + brp(b.pct_cand[ab[1]] || 0) + "%") + c(txtDif(b.votos, ab[0], ab[1])) +
      c(br(b.por_apurar)) + c(b.por_vir === null ? "—" : br(b.por_vir)) + "</tr></tbody></table>" +
      '<p class="cab"><b>' + esc(textoProjecao(m)) + "</b></p>";
  }
  function linhaUf(rot, r, info, m, classe) {
    var ab = par(m), cls = classe ? ' class="' + classe + '"' : "";
    if (!r) return "<tr" + cls + '><td class="l">' + rot + '</td><td colspan="19" class="l">' + situacaoLeitura(info) + "</td></tr>";
    var cand = ab.map(function (nm) {
      return tdN(r.pct_cand[nm] || 0, br(r.votos[nm] || 0) + "<br>" + brp(r.pct_cand[nm] || 0) + "%");
    }).join("");
    return "<tr" + cls + '><td class="l">' + rot + "</td>" +
      tdN(r.pct_sec, br(r.st) + " de " + br(r.ts) + "<br>" + brp(r.pct_sec) + "%") + tdN(r.pct_eleit, brp(r.pct_eleit) + "%") +
      tdN(r.te) + tdN(r.c) + tdN(r.pct_comp, brp(r.pct_comp) + "%") + tdN(r.a) + tdN(r.pct_abst, brp(r.pct_abst) + "%") +
      tdN(r.tv) + tdN(r.vv) + tdN(r.vb) + tdN(r.tvn) + cand +
      tdN((r.votos[ab[0]] || 0) - (r.votos[ab[1]] || 0), txtDif(r.votos, ab[0], ab[1])) +
      '<td class="l">' + marca(r, r.lider) + esc(nomeLider(r.lider)) + "</td>" + tdN(r.por_apurar) +
      tdN(r.por_vir, null, r.base_taxa === "BRASIL" ? "<br>(taxa BR)" : "") +
      '<td class="n">' + esc(r.dg.slice(0, 5)) + "<br>" + esc(r.hg) + '</td><td class="l">' + situacaoLeitura(info) + "</td></tr>";
  }
  function tabelaUfs(m) {
    var ab = par(m);
    var larg = [5.5, 5.5, 4, 5.5, 5.5, 4, 5.5, 4, 5.5, 5.5, 4, 4, 6, 6, 5.5, 4, 5.5, 5.5, 5, 4];  // soma 100
    var corpo = N.UFS.map(function (uf) {
      return linhaUf(band(uf) + '<span title="' + esc(CFG.nome_uf[uf]) + '">' + uf.toUpperCase() + "</span>", m.linhas[uf], m.leitura[uf], m);
    }).join("") + linhaUf("EXTERIOR", m.linhas.zz, m.leitura.zz, m, "fixa") + linhaUf(band("br") + "TOTAL BRASIL", m.br, m.leitura.br, m, "tot");
    return '<table class="ord" id="t-ufs"><colgroup>' + larg.map(function (w) { return '<col style="width:' + w + '%">'; }).join("") +
      "</colgroup><thead><tr><th>UF</th><th>Seções totalizadas</th><th>% eleit. totaliz.</th><th>Aptos</th>" +
      "<th>Compare&shy;ceram (seções totaliz.)</th><th>% comp.</th><th>Abstenção</th><th>% abst.</th><th>Votos apurados</th>" +
      "<th>Válidos</th><th>Brancos</th><th>Nulos</th><th>" + esc(curto(ab[0])) + "</th><th>" + esc(curto(ab[1])) + "</th>" +
      "<th>Diferença</th><th>Líder</th><th>Aptos ainda por apurar (OFICIAL)</th><th>Votos ainda por vir (ESTIMATIVA)</th>" +
      "<th>Última totaliz. TSE</th><th>Leitura</th></tr></thead><tbody>" + corpo + "</tbody></table>";
  }
  function tabelaCelular(m) {
    var ab = par(m);
    function linha(rot, r, classe) {
      var cls = classe ? ' class="' + classe + '"' : "";
      if (!r) return "<tr" + cls + '><td class="l">' + rot + '</td><td colspan="4" class="l">FALHA NA LEITURA</td></tr>';
      return "<tr" + cls + '><td class="l">' + rot + "</td>" + tdN(r.pct_sec, brp(r.pct_sec) + "%") +
        ab.map(function (nm) { return tdN(r.pct_cand[nm] || 0, brp(r.pct_cand[nm] || 0) + "%"); }).join("") +
        tdN((r.votos[ab[0]] || 0) - (r.votos[ab[1]] || 0), marca(r, r.lider) + txtDif(r.votos, ab[0], ab[1])) + "</tr>";
    }
    return '<table class="ord" id="t-cel"><colgroup><col style="width:18%"><col style="width:17%"><col style="width:17%">' +
      '<col style="width:17%"><col style="width:31%"></colgroup><thead><tr><th>UF</th><th>Apurado</th><th>' +
      esc(curto(ab[0])) + "</th><th>" + esc(curto(ab[1])) + "</th><th>Diferença</th></tr></thead><tbody>" +
      N.UFS.map(function (uf) { return linha(band(uf) + uf.toUpperCase(), m.linhas[uf]); }).join("") +
      linha("EXTERIOR", m.linhas.zz, "fixa") + linha(band("br") + "BRASIL", m.br, "tot") + "</tbody></table>";
  }
  function linhaProj(rot, r, m, classe, pctSec, base) {
    var ab = par(m), cls = classe ? ' class="' + classe + '"' : "";
    var cp = pctSec === null || pctSec === undefined ? '<td class="n" data-v="">—</td>' : tdN(pctSec, brp(pctSec) + "%");
    if (!r || !r.proj) return "<tr" + cls + '><td class="l">' + rot + "</td>" + cp +
      '<td colspan="8" class="l">SEM BASE — nenhuma seção totalizada ainda</td></tr>';
    var tv = r.proj_validos, lid = N.lider(Object.keys(r.proj).reduce(function (o, k) { o[k] = Math.round(r.proj[k]); return o; }, {}));
    return "<tr" + cls + '><td class="l">' + rot + "</td>" + cp + tdN(r.por_apurar) + tdN(r.por_vir) +
      '<td class="l">' + esc(base || r.base_taxa || "UF") + "</td>" + tdN(tv) +
      ab.map(function (nm) { return tdN(N.pct(r.proj[nm] || 0, tv), br(r.proj[nm] || 0) + "<br>" + brp(N.pct(r.proj[nm] || 0, tv)) + "%"); }).join("") +
      tdN((r.proj[ab[0]] || 0) - (r.proj[ab[1]] || 0), txtDif(r.proj, ab[0], ab[1])) + '<td class="l">' + esc(nomeLider(lid)) + "</td></tr>";
  }
  function tabelaProjecao(m) {
    var ab = par(m);
    function pc(r) { return r ? r.pct_sec : null; }
    return '<table class="ord medio" id="t-proj"><thead><tr><th>UF</th><th>% seções</th><th>Aptos ainda por apurar</th>' +
      "<th>Votos ainda por vir</th><th>Base da taxa</th><th>Válidos projetados</th><th>" + esc(curto(ab[0])) + " projetado</th><th>" +
      esc(curto(ab[1])) + " projetado</th><th>Diferença projetada</th><th>Líder projetado</th></tr></thead><tbody>" +
      N.UFS.map(function (uf) { return linhaProj(band(uf) + uf.toUpperCase(), m.linhas[uf], m, "", pc(m.linhas[uf])); }).join("") +
      linhaProj("EXTERIOR", m.linhas.zz, m, "fixa", pc(m.linhas.zz)) +
      linhaProj(band("br") + "TOTAL BRASIL (soma das UFs + exterior)", m.proj_br, m, "tot", pc(m.br), "soma das UFs") + "</tbody></table>";
  }
  function tabelaAlertas(m) {
    var ab = par(m), lista = alertas.slice(-60).reverse();
    if (!lista.length) return '<p class="cab">Nenhum boletim novo desde que esta página foi aberta.</p>';
    function cel(v) {
      v = v || { votos: 0, pp: 0 };
      return '<td class="n">' + (v.votos >= 0 ? "+" : "") + br(v.votos) + "<br>" + (v.pp >= 0 ? "+" : "") + brp(v.pp) + " p.p.</td>";
    }
    return '<table class="medio" id="t-alertas"><thead><tr><th>Hora</th><th>UF</th><th>Alerta</th><th>Boletins novos</th>' +
      "<th>Boletins apurados</th><th>Variação da apuração</th><th>Variação " + esc(curto(ab[0])) + "</th><th>Variação " +
      esc(curto(ab[1])) + "</th><th>Liderança</th><th>Totalização TSE</th></tr></thead><tbody>" + lista.map(function (a) {
        return '<tr><td class="n">' + a.hora + '</td><td class="l">' + a.uf + '</td><td class="l">NOVOS BOLETINS' +
          (a.mudou ? " · MUDANÇA DE LIDERANÇA" : "") + '</td><td class="n">' + br(a.novos) + '</td><td class="n">' + br(a.st) +
          " de " + br(a.ts) + '</td><td class="n">+' + brp(a.vp) + " p.p.</td>" + cel(a.var[ab[0]]) + cel(a.var[ab[1]]) +
          '<td class="l">' + (a.mudou ? "ALTERADA para " + esc(curto(a.lider)) : "MANTIDA" + (a.lider && a.lider !== "EMPATE" ? " (" + esc(curto(a.lider)) + ")" : "")) +
          '</td><td class="n">' + esc(a.tse) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  function minutosDesde(dg, hg) {
    var d = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(dg || ""), h = /^(\d\d):(\d\d):(\d\d)$/.exec(hg || "");
    if (!d || !h) return null;
    var quando = Date.UTC(+d[3], +d[2] - 1, +d[1], +h[1] + 3, +h[2], +h[3]);  // horário de Brasília = UTC−3
    return (Date.now() - quando) / 60000;
  }
  function quadroParadas(m) {
    var b = m.br;
    if (!b || !b.st) return '<p class="cab">Apuração ainda não iniciada no Brasil — o quadro passa a valer com as primeiras seções.</p>';
    var itens = [];
    N.PARTES.forEach(function (uf) {
      var r = m.linhas[uf], nome = uf === "zz" ? "EXTERIOR" : uf.toUpperCase();
      if (!r) { itens.push([nome, "SEM LEITURA", "—"]); return; }
      if (r.ts && r.st >= r.ts) return;
      if (!r.st) { itens.push([nome, "SEM TOTALIZAÇÃO", "nenhuma seção totalizada"]); return; }
      var min = minutosDesde(r.dg, r.hg);
      if (min !== null && min > CFG.parada_min) {
        itens.push([nome, "PARADA há " + Math.floor(min) + " min", "última totalização do TSE às " + r.hg + " — " + brp(r.pct_sec) + "% das seções"]);
      }
    });
    if (!itens.length) return '<p class="cab">Nenhuma UF parada: todas as que não chegaram a 100% foram totalizadas nos últimos ' + CFG.parada_min + " minutos.</p>";
    return '<table id="t-paradas"><colgroup><col style="width:12%"><col style="width:22%"><col style="width:66%"></colgroup>' +
      "<thead><tr><th>UF</th><th>Situação</th><th>Detalhe</th></tr></thead><tbody>" + itens.map(function (i) {
        return '<tr><td class="l">' + i[0] + '</td><td class="l">' + i[1] + '</td><td class="l">' + esc(i[2]) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  function tabelaConferencia(m) {
    return '<table id="t-conf"><colgroup><col style="width:34%"><col style="width:18%"><col style="width:18%">' +
      '<col style="width:14%"><col style="width:16%"></colgroup><thead><tr><th>Grandeza</th><th>Arquivo do Brasil (br)</th>' +
      "<th>Soma das 27 UFs + exterior</th><th>Diferença</th><th>Situação</th></tr></thead><tbody>" + m.conf.map(function (c) {
        if (c[1] === null) return '<tr><td class="l">' + esc(c[0]) + '</td><td colspan="4" class="l">' + esc(c[3]) + "</td></tr>";
        return '<tr><td class="l">' + esc(c[0]) + "</td>" + tdN(c[1]) + tdN(c[2]) + tdN(c[2] - c[1]) + '<td class="l">' + c[3] + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  function tabelaEvolucao(m) {
    var ab = par(m), h = evolucao.slice(-40).reverse();
    if (!h.length) return '<p class="cab">Sem leituras ainda.</p>';
    return '<table id="t-evol"><thead><tr><th>Leitura</th><th>Totalização TSE</th><th>% seções</th><th>Seções</th>' +
      "<th>Votos apurados</th><th>" + esc(curto(ab[0])) + "</th><th>" + esc(curto(ab[1])) + "</th><th>Diferença</th></tr></thead><tbody>" +
      h.map(function (x) {
        return '<tr><td class="n">' + x.leitura + '</td><td class="n">' + esc(x.hg) + '</td><td class="n">' + brp(x.pct_sec) +
          '%</td><td class="n">' + br(x.st) + '</td><td class="n">' + br(x.tv) + '</td><td class="n">' + br(x.votos[ab[0]] || 0) +
          " (" + brp(x.pct[ab[0]] || 0) + '%)</td><td class="n">' + br(x.votos[ab[1]] || 0) + " (" + brp(x.pct[ab[1]] || 0) +
          '%)</td><td class="n">' + txtDif(x.votos, ab[0], ab[1]) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  function publicidade() {
    var p = CFG.patrocinio;
    if (!p || !p.itens || !p.itens.length) return "";
    var itens = p.itens.map(function (it) {
      var corpo = esc(it.texto);
      if (it.imagem) corpo = '<img src="patrocinio/' + encodeURIComponent(it.imagem) + '" alt="' + esc(it.texto) + '" style="max-height:60px;vertical-align:middle"> ' + corpo;
      if (/^https?:\/\//i.test(it.link || "")) corpo = '<a href="' + esc(it.link) + '" target="_blank" rel="noopener sponsored">' + corpo + "</a>";
      return '<td class="l">' + corpo + "</td>";
    });
    return '<div id="publicidade"' + (p.no_pdf ? "" : ' class="naoimprime"') + ' style="margin:8px 0"><table><thead><tr><th colspan="' +
      itens.length + '" style="text-align:left">PUBLICIDADE — conteúdo do patrocinador, sem relação com os dados do TSE</th></tr></thead><tbody><tr>' +
      itens.join("") + "</tr></tbody></table></div>";
  }

  var M = null, agoraUlt = null, falta = INTERVALO;
  function desenha() {
    var m = M, agora = agoraUlt;
    var falhas = N.ARQUIVOS.filter(function (u) { return m.leitura[u].falha; }).map(function (u) { return u.toUpperCase(); });
    var conc = m.br && m.br.ts && m.br.st >= m.br.ts;
    var conf = m.conf.every(function (c) { return c[3] === "OK"; }) ? "CONFERÊNCIA OK" :
      (m.conf.some(function (c) { return c[3] === "DIVERGENTE"; }) ? "CONFERÊNCIA DIVERGENTE" : "CONFERÊNCIA NÃO VERIFICÁVEL");
    var dataHora = agora.toLocaleDateString("pt-BR") + " " + hora(agora);
    document.getElementById("conteudo").innerHTML =
      '<header class="barra so-tela"><div><div class="sobre">ELEIÇÃO PRESIDENCIAL 2026 · 2º TURNO · 25/10/2026</div>' +
      '<div class="titulo">Apuração por estado</div><div class="vivo"><span class="estado">' + (conc ? "ENCERRADO" : "AO VIVO") +
      "</span>" + esc(situacao(m)) + " · leitura " + hora(agora) + (conc ? "" : ' · nova leitura em <b id="contador">' + falta + " s</b>") +
      '</div><div class="vivo">Fonte: TSE (resultados oficiais e fotos) · falhas de leitura: ' + (falhas.join(", ") || "nenhuma") +
      " · " + conf + '</div></div><div class="botoes"><button type="button" data-acao="pdf">Imprimir / PDF</button>' +
      '<button type="button" data-acao="csv">Exportar CSV</button><button type="button" data-acao="limpa-ordem">Ordem original</button></div></header>' +
      '<div class="so-papel"><h1>Eleição para Presidente da República — 2º turno — 25/10/2026</h1><p class="cab">Fonte: TSE, ' +
      "resultados.tse.jus.br (ambiente oficial), eleição " + esc(CFG.eleicao) + ". Leitura: <b>" + dataHora + "</b>.</p>" +
      '<p class="cab">Situação: <b>' + esc(situacao(m)) + "</b>. Leituras com falha: <b>" + (falhas.join(", ") || "nenhuma") + "</b>.</p></div>" +
      publicidade() +
      '<section class="so-tela">' + painelBrasil(m) + "</section>" +
      '<h2 class="so-papel">Brasil</h2><div class="rola so-papel">' + resumoPapel(m) + "</div>" +
      '<h2>Por estado</h2><div class="so-celular so-tela"><div class="rola">' + tabelaCelular(m) + "</div>" +
      '<button type="button" class="botao-completa" data-acao="completa">Ver tabela completa</button></div>' +
      '<div class="rola so-largo">' + tabelaUfs(m) + "</div>" +
      '<h2>Projeção do resultado final por estado (ESTIMATIVA)</h2><div class="rola">' + tabelaProjecao(m) + "</div>" +
      '<h2>Alertas de boletins novos (desde que esta página foi aberta)</h2><div class="rola">' + tabelaAlertas(m) + "</div>" +
      "<h2>Estados sem totalização ou parados há mais de " + CFG.parada_min + ' minutos</h2><div class="rola">' + quadroParadas(m) + "</div>" +
      '<h2>Conferência: Brasil × soma dos estados</h2><div class="rola">' + tabelaConferencia(m) + "</div>" +
      '<p class="cab">Os arquivos do TSE são publicados um a um; por alguns segundos a soma pode divergir do total do Brasil ' +
      "sem que haja erro — a divergência que persiste em várias leituras é a que importa.</p>" +
      '<h2>Evolução no Brasil (desde que esta página foi aberta)</h2><div class="rola">' + tabelaEvolucao(m) + "</div>" +
      '<p class="rod"><b>Como ler.</b> Seções totalizadas e % do eleitorado totalizado são medidas diferentes: a primeira conta ' +
      "urnas; a segunda, eleitores aptos das seções já totalizadas. Compareceram, abstenção, brancos e nulos referem-se apenas às " +
      "seções já totalizadas; a abstenção é eleitorado das seções totalizadas − comparecimento. <b>Aptos ainda por apurar " +
      "(OFICIAL)</b> = aptos − eleitorado das seções totalizadas (dado do TSE). <b>Votos ainda por vir (ESTIMATIVA)</b> = aptos " +
      "ainda por apurar × comparecimento atual da UF (sem seção totalizada, o do Brasil, marcado \"taxa BR\"). <b>Projeção</b> = " +
      "votos atuais + votos por vir × proporção de válidos × fatia atual de cada candidato, UF por UF. Estimativa, não resultado. " +
      "Os números vêm direto dos arquivos públicos do TSE, lidos pelo seu navegador a cada minuto; este site não é do TSE.</p>";
    aplica();
  }

  // ---- ordenação (clique no título da coluna), igual à do monitor local
  function numero(td) {
    var v = td.getAttribute("data-v");
    if (v !== null) return v === "" ? null : parseFloat(v);
    var n = parseFloat(td.textContent.trim().split(/\s/)[0].replace(/\./g, "").replace(",", ".").replace("%", ""));
    return isNaN(n) ? null : n;
  }
  function ordena(tab, col, dir) {
    var corpo = tab.tBodies[0], dados = [], fixas = [];
    Array.prototype.forEach.call(corpo.rows, function (r) {
      if (r.classList.contains("tot") || r.classList.contains("fixa")) fixas.push(r); else dados.push(r);
    });
    dados.sort(function (x, y) {
      var a = x.cells[col], b = y.cells[col];
      if (!a || !b) return 0;
      var na = numero(a), nb = numero(b);
      return dir * ((na === null || nb === null) ? a.textContent.localeCompare(b.textContent, "pt-BR") : na - nb);
    });
    dados.concat(fixas).forEach(function (r) { corpo.appendChild(r); });
    Array.prototype.forEach.call(tab.tHead.rows[0].cells, function (th, i) {
      if (i === col) th.setAttribute("data-seta", dir > 0 ? "▲" : "▼"); else th.removeAttribute("data-seta");
    });
  }
  function aplica() {
    document.querySelectorAll("table.ord").forEach(function (tab) { var e = est[tab.id]; if (e) ordena(tab, e.col, e.dir); });
    var bc = document.querySelector('[data-acao="completa"]');
    if (bc) bc.textContent = document.body.classList.contains("completa") ? "Ver tabela compacta" : "Ver tabela completa";
  }

  // ---- CSV (; + vírgula decimal + BOM), gerado no próprio navegador
  function csv() {
    var m = M, c = m.ordem, f = function (x) { return x === null || x === undefined ? "" : (typeof x === "number" && !Number.isInteger(x) ? x.toFixed(2).replace(".", ",") : String(x)); };
    var cab = ["UF", "Nome", "Secoes totais", "Secoes totalizadas", "% secoes", "% eleitorado totalizado", "Aptos",
               "Eleitorado das secoes totalizadas", "Compareceram", "% comparecimento", "Abstencao", "% abstencao",
               "Votos apurados", "Validos", "Brancos", "Nulos"];
    c.forEach(function (nm) { cab.push(nm + " votos", nm + " % validos"); });
    cab = cab.concat(["Lider", "Aptos ainda por apurar (oficial)", "Votos ainda por vir (estimativa)"],
                     c.map(function (nm) { return nm + " projetado (estimativa)"; }), ["Data TSE", "Hora TSE"]);
    var linhas = [cab];
    N.UFS.map(function (u) { return [u.toUpperCase(), CFG.nome_uf[u], m.linhas[u], m.linhas[u] && m.linhas[u].proj]; })
      .concat([["ZZ", "Exterior", m.linhas.zz, m.linhas.zz && m.linhas.zz.proj], ["BR", "Total Brasil", m.br, m.proj_br.proj]])
      .forEach(function (it) {
        var r = it[2];
        if (!r) { linhas.push([it[0], it[1]]); return; }
        var l = [it[0], it[1], r.ts, r.st, f(r.pct_sec), f(r.pct_eleit), r.te, r.est, r.c, f(r.pct_comp), r.a, f(r.pct_abst), r.tv, r.vv, r.vb, r.tvn];
        c.forEach(function (nm) { l.push(r.votos[nm] || 0, f(r.pct_cand[nm] || 0)); });
        l.push(r.lider, r.por_apurar, r.por_vir === null ? "" : Math.round(r.por_vir));
        c.forEach(function (nm) { l.push(it[3] ? Math.round(it[3][nm] || 0) : ""); });
        l.push(r.dg, r.hg);
        linhas.push(l);
      });
    var texto = "﻿" + linhas.map(function (l) {
      return l.map(function (x) { x = String(x == null ? "" : x); return /[;"\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(";");
    }).join("\r\n") + "\r\n";
    var a = document.createElement("a"), agora = new Date(), p = function (n) { return ("0" + n).slice(-2); };
    a.href = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
    a.download = "monitor_2turno_presidente_" + agora.getFullYear() + "-" + p(agora.getMonth() + 1) + "-" + p(agora.getDate()) +
      "_" + p(agora.getHours()) + p(agora.getMinutes()) + p(agora.getSeconds()) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
  }

  document.addEventListener("click", function (ev) {
    var th = ev.target.closest("table.ord thead th");
    if (th) {
      var tab = th.closest("table"), col = th.cellIndex, e = est[tab.id];
      var dir = (e && e.col === col) ? -e.dir : (col === 0 ? 1 : -1);
      est[tab.id] = { col: col, dir: dir };
      try { sessionStorage.setItem(CHAVE, JSON.stringify(est)); } catch (x) {}
      ordena(tab, col, dir);
      return;
    }
    var b = ev.target.closest("[data-acao]");
    if (!b || !M) return;
    var acao = b.getAttribute("data-acao");
    if (acao === "pdf") window.print();
    else if (acao === "csv") csv();
    else if (acao === "completa") { document.body.classList.toggle("completa"); aplica(); }
    else if (acao === "limpa-ordem") {
      est = {};
      try { sessionStorage.removeItem(CHAVE); } catch (x) {}
      desenha();
    }
  });

  function rodada() {
    ciclo().then(function (agora) {
      M = N.monta(ultimo); agoraUlt = agora;
      registra(M, agora);
      falta = INTERVALO;
      desenha();
      var conc = M.br && M.br.ts && M.br.st >= M.br.ts;
      if (!conc) setTimeout(rodada, INTERVALO * 1000);
    });
  }
  setInterval(function () {
    var el = document.getElementById("contador");
    if (el && falta > 1) { falta -= 1; el.textContent = falta + " s"; }
  }, 1000);
  rodada();
})(NUCLEO);
