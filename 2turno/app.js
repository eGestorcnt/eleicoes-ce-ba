/* Painel PÚBLICO de Presidente 2026: 2º turno (eleição 6258, 25/10) ou 1º turno (6257, 04/10),
 * conforme a configuração da página (ilha JSON "config": eleicao, turno, rotulo, titulo, arquivo).
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
  // regiões do IBGE; o exterior fica como região à parte para a soma bater com o Brasil
  var REGIOES = [["Norte", ["ac", "am", "ap", "pa", "ro", "rr", "to"]],
                 ["Nordeste", ["al", "ba", "ce", "ma", "pb", "pe", "pi", "rn", "se"]],
                 ["Centro-Oeste", ["df", "go", "ms", "mt"]],
                 ["Sudeste", ["es", "mg", "rj", "sp"]],
                 ["Sul", ["pr", "rs", "sc"]],
                 ["Exterior", ["zz"]]];
  var SOMA = ["ts", "st", "te", "est", "esnt", "c", "a", "tv", "vv", "vb", "tvn"];

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

  // soma das UFs da região (mesmos campos do arquivo do TSE) e os mesmos cálculos de uma UF;
  // UF sem leitura fica em "faltam" e a soma é PARCIAL
  function somaRegiao(linhas, ufs) {
    var base = null, faltam = [];
    ufs.forEach(function (uf) {
      var d = linhas[uf];
      if (!d) { faltam.push(uf); return; }
      if (!base) {
        base = { abr: "", dg: "", hg: "", ordem: d.ordem.slice(), votos: {}, situacao: {}, numero: Object.assign({}, d.numero), sq: {} };
        SOMA.forEach(function (k) { base[k] = 0; });
      }
      SOMA.forEach(function (k) { base[k] += d[k] || 0; });
      d.ordem.forEach(function (nm) { base.votos[nm] = (base.votos[nm] || 0) + (d.votos[nm] || 0); });
    });
    if (!base) return null;
    var r = calcula(base);
    r.faltam = faltam;
    r.estados = ufs.filter(function (uf) { return uf !== "zz"; });
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

  // os dois candidatos das colunas: no 2º turno, a ordem do TSE (as colunas não trocam de lugar quando a
  // liderança muda); no 1º turno, os dois mais votados no Brasil
  function principais(m, porVotos) {
    var o = m.ordem.slice();
    if (porVotos && m.br) {
      o.sort(function (x, y) {
        return (m.br.votos[y] || 0) - (m.br.votos[x] || 0) || m.ordem.indexOf(x) - m.ordem.indexOf(y);
      });
    }
    o = o.concat(["", ""]);
    return [o[0], o[1]];
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
    var regioes = REGIOES.map(function (rg) { return { nome: rg[0], ufs: rg[1], r: somaRegiao(linhas, rg[1]) }; });
    return { br: dados.br ? calcula(dados.br, ref) : null, linhas: linhas, ordem: base.ordem, regioes: regioes,
             proj_br: somaProjecao(linhas), conf: conferencia(dados.br, partes), leitura: leitura };
  }

  // ---- boletim de urna (bu.dat do TSE): BER mínimo, mesma leitura de ../monitor_ao_vivo/bu.py
  // envelope -> EntidadeBoletimUrna: identificacaoSecao {municipioZona {municipio, zona}, local, secao} e
  // resultadosVotacaoPorEleicao [{idEleicao, qtdEleitoresAptos, resultadosVotacao [{tipoCargo,
  // qtdComparecimento, totaisVotosCargo [{codigoCargo, ordem, votosVotaveis [{tipoVoto [1], qtd [2],
  // identificacaoVotavel [3] {partido, codigo}}]}]}]}]. tipoVoto: 1 nominal, 2 branco, 3 nulo, 4 legenda.
  var TIPO_VOTO = { 1: "nominal", 2: "branco", 3: "nulo", 4: "legenda", 5: "cargo_sem_candidato" };
  function leBer(b, i, fim) {
    var nos = [];
    while (i < fim) {
      var t = b[i++], cls = t >> 6, cons = (t >> 5) & 1, tag = t & 31, x;
      if (tag === 31) { tag = 0; do { x = b[i++]; tag = tag * 128 + (x & 127); } while (x & 128); }
      var n = b[i++];
      if (n & 128) { var k = n & 127; n = 0; for (var j = 0; j < k; j++) n = n * 256 + b[i++]; }
      nos.push({ cls: cls, cons: cons, tag: tag, val: b.subarray(i, i + n), filhos: cons ? leBer(b, i, i + n) : null });
      i += n;
    }
    return nos;
  }
  function intBer(no) {
    var v = no.val, x = 0;
    if (!v || !v.length) return 0;
    for (var k = 0; k < v.length; k++) x = x * 256 + v[k];
    return v[0] & 128 ? x - Math.pow(256, v.length) : x;
  }
  function eSeq(no) { return no.cons && no.cls === 0 && no.tag === 16; }
  function boletim(bytes) {
    var env = leBer(bytes, 0, bytes.length)[0];
    var conteudo = env.filhos.filter(function (f) { return f.cls === 0 && f.tag === 4 && !f.cons; })[0];
    var ebu = leBer(conteudo.val, 0, conteudo.val.length)[0];
    var out = { local: null, secao: null, municipio: null, zona: null, eleicoes: {} };
    ebu.filhos.forEach(function (f) {
      if (eSeq(f) && f.filhos.length === 3 && eSeq(f.filhos[0]) && f.filhos[0].filhos.length === 2 &&
          f.filhos[1].tag === 2 && f.filhos[2].tag === 2 && out.local === null) {
        out.municipio = intBer(f.filhos[0].filhos[0]); out.zona = intBer(f.filhos[0].filhos[1]);
        out.local = intBer(f.filhos[1]); out.secao = intBer(f.filhos[2]);
      }
      if (eSeq(f) && f.filhos.length && f.filhos.every(eSeq)) {
        f.filhos.forEach(function (rve) {
          var fs = rve.filhos;
          if (fs.length < 3 || fs[0].tag !== 2 || fs[1].tag !== 2) return;
          var resultados = fs.slice(2).filter(eSeq)[0];
          if (!resultados) return;
          var cargos = {};
          resultados.filhos.forEach(function (rv) {
            var comp = intBer(rv.filhos[1]);
            rv.filhos[2].filhos.forEach(function (tvc) {
              var cargo = tvc.filhos[0].cons ? intBer(tvc.filhos[0].filhos[0]) : intBer(tvc.filhos[0]);
              var votos = tvc.filhos[2].filhos.map(function (vv) {
                var tipo = null, qtd = 0, codigo = null;
                vv.filhos.forEach(function (c) {
                  if (c.cls === 2 && c.tag === 1) tipo = intBer(c);
                  else if (c.cls === 2 && c.tag === 2) qtd = intBer(c);
                  else if (c.cls === 2 && c.tag === 3 && c.cons) codigo = intBer(c.filhos[1]);
                });
                return { tipo: TIPO_VOTO[tipo] || String(tipo), qtd: qtd, codigo: codigo };
              });
              cargos[cargo] = { comparecimento: comp, votos: votos };
            });
          });
          out.eleicoes[intBer(fs[0])] = { aptos: intBer(fs[1]), cargos: cargos };
        });
      }
    });
    return out;
  }
  // Presidente (cargo 1) da eleição pedida: aptos, comparecimento, brancos, nulos e votos por nome de urna
  function resumoBoletim(bu, eleicao, numero) {
    var e = bu && bu.eleicoes[eleicao];
    if (!e || !e.cargos[1]) return null;
    var porNumero = {};
    Object.keys(numero || {}).forEach(function (nm) { porNumero[String(numero[nm])] = nm; });
    var c = e.cargos[1], r = { aptos: e.aptos, c: c.comparecimento, vb: 0, tvn: 0, vv: 0, votos: {} };
    c.votos.forEach(function (v) {
      if (v.tipo === "nominal") {
        var nm = porNumero[String(v.codigo)] || ("Nº " + v.codigo);
        r.votos[nm] = (r.votos[nm] || 0) + v.qtd;
        r.vv += v.qtd;
      } else if (v.tipo === "branco") r.vb += v.qtd;
      else if (v.tipo === "nulo") r.tvn += v.qtd;
    });
    return r;
  }

  // ---- frase-resumo do topo. Nunca declara eleito por conta própria: só repete a situação publicada pelo TSE.
  function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  function fmtPct(x) { return x.toFixed(2).replace(".", ","); }
  function nome1(nm) { return nm ? nm.split(" ")[0] : ""; }
  function fraseResumo(m, turno, data2t) {
    var b = m.br;
    if (!b || m.ordem.length < 2) return "";
    var ordem = m.ordem.slice().sort(function (x, y) {
      return (b.votos[y] || 0) - (b.votos[x] || 0) || m.ordem.indexOf(x) - m.ordem.indexOf(y);
    });
    var a = ordem[0], c = ordem[1], pa = b.pct_cand[a] || 0, pc = b.pct_cand[c] || 0;
    var dif = (b.votos[a] || 0) - (b.votos[c] || 0);
    if (!b.st) return "A apuração do " + turno + "º turno começa a ser divulgada pelo TSE a partir das 17h (Brasília).";
    if (b.ts && b.st >= b.ts) {
      var s = "Resultado final: " + nome1(a) + " " + fmtPct(pa) + "% e " + nome1(c) + " " + fmtPct(pc) + "% dos votos válidos";
      if (turno === 1) {
        if (pa > 50) return s + ". " + nome1(a) + " passou de 50% dos válidos.";
        return s + ". Ninguém passou de 50%: os dois disputam o 2º turno" + (data2t ? " em " + data2t : "") + ".";
      }
      var eleito = ordem.filter(function (nm) { return /^eleit/i.test(b.situacao[nm] || ""); })[0];
      return s + ", diferença de " + fmtInt(dif) + " votos." + (eleito ? " Situação no TSE: " + nome1(eleito) + " ELEITO." : "");
    }
    if (!dif) return "Com " + fmtPct(b.pct_sec) + "% das seções apuradas, " + nome1(a) + " e " + nome1(c) + " estão empatados.";
    return "Com " + fmtPct(b.pct_sec) + "% das seções apuradas, " + nome1(a) + " lidera com " + fmtPct(pa) +
      "% dos válidos, " + fmtInt(dif) + " votos à frente de " + nome1(c) + ".";
  }
  // ---- frase animada e NEUTRA no cartão de cada candidato, durante a apuração (vale igual para os dois; nunca
  // ridiculariza ninguém): VIRADA, ampliou / encurtou (em relação à leitura anterior), voto a voto (< 1 ponto),
  // reta final (90%+), empate. Antes e depois da apuração, nenhuma frase. Devolve {nome de urna: frase}.
  function frasesCartao(m, anterior) {
    var b = m.br, out = {};
    if (!b || m.ordem.length < 2 || !b.st || (b.ts && b.st >= b.ts)) return out;
    var ordem = m.ordem.slice().sort(function (x, y) {
      return (b.votos[y] || 0) - (b.votos[x] || 0) || m.ordem.indexOf(x) - m.ordem.indexOf(y);
    });
    var a = ordem[0], c = ordem[1], pa = b.pct_cand[a] || 0, pc = b.pct_cand[c] || 0;
    var dif = (b.votos[a] || 0) - (b.votos[c] || 0), d = fmtInt(dif);
    if (!dif) { out[a] = out[c] = "Empate absoluto: mesmo número de votos"; return out; }
    var liderAnt = "", difAnt = null;
    if (anterior && anterior.votos) {
      var va = anterior.votos[a] || 0, vc = anterior.votos[c] || 0;
      liderAnt = va > vc ? a : (vc > va ? c : "");
      difAnt = Math.abs(va - vc);
    }
    if (liderAnt && liderAnt !== a) {
      out[a] = "VIRADA! Passou à frente por " + d + " votos";
      out[c] = "Agora a " + d + " votos do líder";
    } else if (b.pct_sec >= 90) {
      out[a] = "Reta final: à frente por " + d + " votos";
      out[c] = "Reta final: a " + d + " votos do líder";
    } else if (pa - pc < 1) {
      out[a] = out[c] = "Voto a voto: só " + fmtPct(pa - pc) + " ponto percentual de diferença";
    } else if (difAnt !== null && liderAnt === a && dif > difAnt) {
      out[a] = "Ampliou a vantagem: à frente por " + d + " votos";
      out[c] = "A " + d + " votos do líder";
    } else if (difAnt !== null && liderAnt === a && dif < difAnt) {
      out[a] = "À frente por " + d + " votos";
      out[c] = "Encurtou a distância: a " + d + " votos do líder";
    } else {
      out[a] = "À frente por " + d + " votos";
      out[c] = "A " + d + " votos do líder";
    }
    return out;
  }

  // ---- 2º turno × 1º turno por UF: % dos válidos de cada um dos dois nas duas eleições e quem estava à frente
  function soDoisN(v, ab) { var o = {}; o[ab[0]] = (v || {})[ab[0]] || 0; o[ab[1]] = (v || {})[ab[1]] || 0; return o; }
  function comparaTurnos(m1, m2, ab) {
    return PARTES.concat(["br"]).map(function (uf) {
      var r1 = uf === "br" ? m1.br : m1.linhas[uf], r2 = uf === "br" ? m2.br : m2.linhas[uf];
      if (!r1) return { uf: uf, falta: true };
      var tem2 = !!(r2 && r2.vv);
      var o = { uf: uf, p1: {}, p2: {}, var: {}, lider1: lider(soDoisN(r1.votos, ab)), lider2: tem2 ? lider(soDoisN(r2.votos, ab)) : "" };
      ab.forEach(function (nm) {
        o.p1[nm] = r1.pct_cand[nm] || 0;
        o.p2[nm] = tem2 ? (r2.pct_cand[nm] || 0) : null;
        o.var[nm] = tem2 ? o.p2[nm] - o.p1[nm] : null;
      });
      o.virou = !!(o.lider1 && o.lider2 && o.lider1 !== o.lider2 && o.lider1 !== "EMPATE" && o.lider2 !== "EMPATE");
      return o;
    });
  }

  // ---- projeção PELO 1º TURNO: em cada UF, os válidos que ainda faltam (mesma estimativa da projeção principal:
  // proj_validos − válidos já apurados) se dividem entre os dois como se dividiram no 1º turno daquela UF,
  // contando só os votos dos dois. Brasil = soma das UFs e do exterior (some se faltar uma unidade).
  function projecaoPeloT1(m2, m1, ab) {
    var tot = { proj: {}, proj_validos: 0, faltam: [] }, linhas = {};
    ab.forEach(function (nm) { tot.proj[nm] = 0; });
    PARTES.forEach(function (uf) {
      var r = m2.linhas[uf], r1 = m1 && m1.linhas[uf];
      var s1 = r1 ? (r1.votos[ab[0]] || 0) + (r1.votos[ab[1]] || 0) : 0;
      if (!r || r.proj_validos === null || r.proj_validos === undefined || !s1) { tot.faltam.push(uf); linhas[uf] = null; return; }
      var faltaVal = r.proj_validos - r.vv, p = {};
      ab.forEach(function (nm) {
        p[nm] = (r.votos[nm] || 0) + faltaVal * (r1.votos[nm] || 0) / s1;
        tot.proj[nm] += p[nm];
      });
      tot.proj_validos += r.proj_validos;
      linhas[uf] = { proj: p, proj_validos: r.proj_validos };
    });
    if (tot.faltam.length) tot.proj = null;
    return { linhas: linhas, br: tot };
  }

  return { UFS: UFS, EXTERIOR: EXTERIOR, PARTES: PARTES, ARQUIVOS: ARQUIVOS, REGIOES: REGIOES, somaRegiao: somaRegiao,
           fraseResumo: fraseResumo, frasesCartao: frasesCartao, comparaTurnos: comparaTurnos, projecaoPeloT1: projecaoPeloT1,
           boletim: boletim, resumoBoletim: resumoBoletim,
           inteiro: inteiro, extrai: extrai,
           pct: pct, lider: lider, referencia: referencia, calcula: calcula, somaProjecao: somaProjecao,
           conferencia: conferencia, monta: monta, principais: principais };
})();

if (typeof module !== "undefined") module.exports = NUCLEO;

if (typeof document !== "undefined") (function (N) {
  var CFG = JSON.parse(document.getElementById("config").textContent);
  var RAIZ = "https://resultados.tse.jus.br/oficial/ele2026/" + CFG.eleicao;
  // 5 s: o CDN do TSE guarda cada arquivo ~60 s; dentro desse prazo o próprio navegador responde do cache,
  // então pedir a cada 5 s pega a versão nova logo que sai, sem pesar no TSE
  var INTERVALO = 5;
  var COR = { "13": "#C62828", "22": "#1D4ED8" };
  var ultimo = {}, anterior = {}, alertas = [], alertados = {}, evolucao = [];
  // evolução e alertas ficam guardados NESTE navegador (recarregar a página não apaga); só conveniência:
  // sem localStorage (aba anônima, bloqueio), a página segue funcionando com o que viu desde que abriu
  var CHAVE_HIST = "hist:" + CFG.eleicao;
  try {
    var salvo = JSON.parse(localStorage.getItem(CHAVE_HIST) || "null");
    if (salvo && salvo.v === 1) {
      evolucao = salvo.evolucao || []; alertas = salvo.alertas || []; alertados = salvo.alertados || {};
    }
  } catch (e) {}
  function guardaHistorico() {
    try {
      var chaves = Object.keys(alertados).slice(-3000), a = {};
      chaves.forEach(function (k) { a[k] = 1; });
      localStorage.setItem(CHAVE_HIST, JSON.stringify({ v: 1, evolucao: evolucao.slice(-2000), alertas: alertas.slice(-300), alertados: a }));
    } catch (e) {}
  }
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
  function par(m) { return N.principais(m, CFG.turno === 1); }
  function soDois(v, ab) { var o = {}; o[ab[0]] = (v || {})[ab[0]] || 0; o[ab[1]] = (v || {})[ab[1]] || 0; return o; }
  function cor(d, nm) { return COR[((d || {}).numero || {})[nm]] || "#475569"; }
  function marca(d, nm) { return (!nm || nm === "EMPATE") ? "" : '<span class="cor" style="background:' + cor(d, nm) + '"></span>'; }
  function band(uf) { return '<img class="band" src="bandeiras/' + uf + '.png" alt="">'; }
  // bandeira + sigla clicáveis: abrem a consulta por município daquela UF
  function ufLink(uf, rotulo) {
    return '<a class="ufl" href="#cidades-' + uf + '" data-acao="cidades" data-uf="' + uf + '" title="Ver por município — ' +
      esc(uf === "zz" ? "Exterior" : CFG.nome_uf[uf]) + '">' + (uf === "zz" ? "" : band(uf)) + (rotulo || uf.toUpperCase()) + "</a>";
  }
  function nomeLider(nm) { return nm && nm !== "EMPATE" ? curto(nm) : (nm || "—"); }
  function txtDif(votos, a, b) {
    var d = Math.round((votos[a] || 0) - (votos[b] || 0));
    if (d === 0) return Object.keys(votos).some(function (k) { return votos[k]; }) ? "EMPATE" : "—";
    return curto(d > 0 ? a : b) + " +" + br(Math.abs(d));
  }
  // Diferença: fundo claro na cor de quem lidera (classes lid-13 / lid-22 do CSS do painel)
  function classeLider(votos, numero) {
    var arred = {};
    Object.keys(votos || {}).forEach(function (k) { arred[k] = Math.round(votos[k]); });
    var n = (numero || {})[N.lider(arred)] || "";
    return COR[n] ? " lid-" + n : "";
  }
  function tdN(v, texto, extra, classe) {
    classe = classe || "";
    if (v === null || v === undefined) return '<td class="n' + classe + '" data-v="">—' + (extra || "") + "</td>";
    return '<td class="n' + classe + '" data-v="' + v.toFixed(4) + '">' + (texto !== undefined && texto !== null ? texto : br(v)) + (extra || "") + "</td>";
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
  var ELE6 = ("000000" + CFG.eleicao).slice(-6);
  function baixa(uf) { return baixaUrl(RAIZ + "/dados/" + uf + "/" + uf + "-c0001-e" + ELE6 + "-u.jws"); }
  function baixaUrl(url, tentativa) {
    tentativa = tentativa || 0;
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 20000);
    return fetch(url, { signal: ctl.signal })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (t) { return decodifica(t); })
      .finally(function () { clearTimeout(t); })
      .catch(function (e) {
        if (tentativa >= 2) throw e;
        return espera(2000 * Math.pow(2, tentativa)).then(function () { return baixaUrl(url, tentativa + 1); });
      });
  }
  function buscaCom(url, tipo, tentativa) {
    tentativa = tentativa || 0;
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 20000);
    return fetch(url, { signal: ctl.signal }).then(function (r) {
      if (!r.ok) { var e = new Error("HTTP " + r.status); e.http = r.status; throw e; }
      return tipo === "bin" ? r.arrayBuffer().then(function (a) { return new Uint8Array(a); }) : r.json();
    }).finally(function () { clearTimeout(t); }).catch(function (e) {
      if (e.http === 404 || tentativa >= 2) throw e;
      return espera(2000 * Math.pow(2, tentativa)).then(function () { return buscaCom(url, tipo, tentativa + 1); });
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
    guardaHistorico();
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
  function textoProjecaoT1(m) {
    if (erroT1) return "PROJEÇÃO PELO 1º TURNO: FALHA NA LEITURA do resultado do 1º turno.";
    if (!M1) return "PROJEÇÃO PELO 1º TURNO: carregando o resultado do 1º turno...";
    var ab = par(m), p = N.projecaoPeloT1(m, M1, ab).br;
    if (!p.proj) return "PROJEÇÃO PELO 1º TURNO: sem base ainda — nenhuma seção totalizada.";
    var tv = p.proj_validos;
    return "PROJEÇÃO PELO 1º TURNO (ESTIMATIVA, soma das UFs): " + ab.map(function (nm) {
      return curto(nm) + " " + br(p.proj[nm]) + " (" + brp(N.pct(p.proj[nm], tv)) + "%)";
    }).join(" × ") + "; diferença projetada " + txtDif(p.proj, ab[0], ab[1]) + ". Premissa: em cada UF, os votos válidos " +
      "que ainda faltam se dividem entre os dois como se dividiram no 1º turno daquela UF (só os votos dos dois). Não é resultado.";
  }

  function textoProjecao(m) {
    var pb = m.proj_br, ab = par(m);
    if (m.br && m.br.ts && m.br.st >= m.br.ts) {
      return "Apuração concluída: 100% das seções totalizadas. Os números acima são o resultado oficial do TSE — não há projeção.";
    }
    if (!pb.proj) return "PROJEÇÃO do Brasil: sem base ainda — nenhuma seção totalizada.";
    var tv = pb.proj_validos;
    return "PROJEÇÃO ao fim da apuração (ESTIMATIVA, soma das UFs): " + ab.map(function (nm) {
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
        return "<span>" + ufLink(it[0]) + " " + brp(it[1]) + "%</span>";
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
    var dois = frente.slice(0, 2);
    var resto = Math.max(0, 100 - dois.reduce(function (s, nm) { return s + (b.pct_cand[nm] || 0); }, 0));
    var frases = N.frasesCartao(m, evolucao.length > 1 ? evolucao[evolucao.length - 2] : null);
    var cards = dois.map(function (nm) {
      var sq = (b.sq || {})[nm], foto = /^\d+$/.test(sq || "") ?
        '<img class="foto" src="' + RAIZ + "/fotos/br/" + sq + '.jpeg" alt="Foto de ' + esc(nm) + '">' : "";
      return '<div class="cartao cand" style="--cor:' + cor(b, nm) + '"><div class="topo-cand">' + foto +
        '<div><div class="num">Nº ' + esc(b.numero[nm]) + '</div><div class="nome">' + esc(nm) + "</div></div>" +
        estadosNaFrente(m, nm) + "</div>" +
        '<div class="pct">' + brp(b.pct_cand[nm] || 0) + '%</div><div class="votos">' + br(b.votos[nm] || 0) +
        " votos válidos</div>" + (frases[nm] ? '<div class="frase-cand">' + esc(frases[nm]) + "</div>" : "") + (b.situacao[nm] ? '<div class="eleito">' + esc(b.situacao[nm].toUpperCase()) + "</div>" : "") + "</div>";
    }).join("");
    var divisao;
    if (b.vv) {
      divisao = '<div class="meio"><div class="divisao">' + dois.map(function (nm) {
        return '<span style="width:' + (b.pct_cand[nm] || 0).toFixed(3) + "%;background:" + cor(b, nm) + '"></span>';
      }).join("") + (resto > 0.005 ? '<span style="width:' + resto.toFixed(3) + '%;background:#94A3B8"></span>' : "") +
        '</div></div><div class="legenda">' + dois.map(function (nm) {
        return "<span>" + esc(curto(nm)) + " " + brp(b.pct_cand[nm] || 0) + "%</span>";
      }).join("") + (resto > 0.005 ? "<span>demais " + brp(resto) + "%</span>" : "") + '</div><div class="legenda"><span>Diferença: <b>' + txtDif(b.votos, ab[0], ab[1]) +
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
      }).join("") + '</div><div class="cartao proj">' + esc(textoProjecao(m)) + "</div>" +
      (CFG.turno === 2 && !(b.ts && b.st >= b.ts) ? '<div class="cartao proj proj2">' + esc(textoProjecaoT1(m)) + "</div>" : "");
  }
  function rankingCandidatos(m) {
    var b = m.br;
    if (!b || m.ordem.length <= 2) return "";
    var lista = m.ordem.slice().sort(function (x, y) { return (b.votos[y] || 0) - (b.votos[x] || 0); });
    return '<table class="ord medio" id="t-cand"><colgroup><col style="width:7%"><col style="width:7%"><col style="width:26%">' +
      '<col style="width:13%"><col style="width:10%"><col style="width:12%"><col style="width:25%"></colgroup><thead><tr>' +
      "<th>Posição</th><th>Nº</th><th>Candidato</th><th>Votos</th><th>% válidos</th><th>Situação</th>" +
      "<th>Estados em 1º lugar</th></tr></thead><tbody>" + lista.map(function (nm, i) {
        var ufs = N.UFS.filter(function (uf) { return m.linhas[uf] && m.linhas[uf].lider === nm; });
        return '<tr><td class="n">' + (i + 1) + 'º</td><td class="n">' + esc(b.numero[nm]) + '</td><td class="l">' +
          marca(b, nm) + esc(nm) + "</td>" + tdN(b.votos[nm] || 0) + tdN(b.pct_cand[nm] || 0, brp(b.pct_cand[nm] || 0) + "%") +
          '<td class="l">' + esc((b.situacao[nm] || "").toUpperCase()) + "</td>" +
          '<td class="l" data-v="' + ufs.length + '">' + (ufs.length ? ufs.length + ": " + ufs.map(function (uf) {
            return ufLink(uf);
          }).join(" ") : "—") + "</td></tr>";
      }).join("") + "</tbody></table>";
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
  // % de cada candidato no 1º turno, em cinza embaixo do % atual (só na página do 2º turno, depois de ler o 1º turno).
  // chave: sigla da UF, "br" ou "reg:<n>" (n = posição da região em N.REGIOES)
  function t1(chave, nm) {
    if (CFG.turno !== 2 || !M1 || !chave) return "";
    var r = chave === "br" ? M1.br : (chave.indexOf("reg:") === 0 ? (M1.regioes[+chave.slice(4)] || {}).r : M1.linhas[chave]);
    return r ? '<br><span class="t1">' + brp(r.pct_cand[nm] || 0) + "%</span>" : "";
  }
  function legendaT1() {
    return CFG.turno === 2 && M1 ? '<p class="cab legenda-t1">Na etiqueta cinza, abaixo de cada percentual: o resultado do 1º turno (04/10).</p>' : "";
  }

  function linhaUf(rot, r, info, m, classe, chave) {
    var ab = par(m), cls = classe ? ' class="' + classe + '"' : "";
    if (!r) return "<tr" + cls + '><td class="l">' + rot + '</td><td colspan="19" class="l">' + situacaoLeitura(info) + "</td></tr>";
    var cand = ab.map(function (nm) {
      return tdN(r.pct_cand[nm] || 0, br(r.votos[nm] || 0) + "<br>" + brp(r.pct_cand[nm] || 0) + "%" + t1(chave, nm));
    }).join("");
    return "<tr" + cls + '><td class="l">' + rot + "</td>" +
      tdN(r.pct_sec, br(r.st) + " de " + br(r.ts) + "<br>" + brp(r.pct_sec) + "%", "", " qb") + tdN(r.pct_eleit, brp(r.pct_eleit) + "%") +
      tdN(r.te) + tdN(r.c) + tdN(r.pct_comp, brp(r.pct_comp) + "%") + tdN(r.a) + tdN(r.pct_abst, brp(r.pct_abst) + "%") +
      tdN(r.tv) + tdN(r.vv) + tdN(r.vb) + tdN(r.tvn) + cand +
      tdN((r.votos[ab[0]] || 0) - (r.votos[ab[1]] || 0), txtDif(r.votos, ab[0], ab[1]), "", classeLider(soDois(r.votos, ab), r.numero)) +
      '<td class="l">' + marca(r, r.lider) + esc(nomeLider(r.lider)) + "</td>" + tdN(r.por_apurar) +
      tdN(r.por_vir, null, r.base_taxa === "BRASIL" ? "<br>(taxa BR)" : "") +
      '<td class="n">' + esc(r.dg.slice(0, 5)) + "<br>" + esc(r.hg) + '</td><td class="l">' + situacaoLeitura(info) + "</td></tr>";
  }
  function tabelaUfs(m) {
    var ab = par(m);
    var larg = [5.5, 5.5, 4, 5.5, 5.5, 4, 5.5, 4, 5.5, 5.5, 4, 4, 6, 6, 5.5, 4, 5.5, 5.5, 5, 4];  // soma 100
    var corpo = N.UFS.map(function (uf) {
      return linhaUf(ufLink(uf), m.linhas[uf], m.leitura[uf], m, "", uf);
    }).join("") + linhaUf(ufLink("zz", "EXTERIOR"), m.linhas.zz, m.leitura.zz, m, "fixa", "zz") +
      linhaUf(band("br") + "TOTAL BRASIL", m.br, m.leitura.br, m, "tot", "br");
    return '<table class="ord" id="t-ufs"><colgroup>' + larg.map(function (w) { return '<col style="width:' + w + '%">'; }).join("") +
      "</colgroup><thead><tr><th>UF</th><th>Seções totalizadas</th><th>% eleit. totaliz.</th><th>Aptos</th>" +
      "<th>Compare&shy;ceram (seções totaliz.)</th><th>% comp.</th><th>Abstenção</th><th>% abst.</th><th>Votos apurados</th>" +
      "<th>Válidos</th><th>Brancos</th><th>Nulos</th><th>" + esc(curto(ab[0])) + "</th><th>" + esc(curto(ab[1])) + "</th>" +
      "<th>Diferença</th><th>Líder</th><th>Aptos ainda por apurar (OFICIAL)</th><th>Votos ainda por vir (ESTIMATIVA)</th>" +
      "<th>Última totaliz. TSE</th><th>Leitura</th></tr></thead><tbody>" + corpo + "</tbody></table>";
  }
  function tabelaCelular(m) {
    var ab = par(m);
    function linha(rot, r, classe, chave) {
      var cls = classe ? ' class="' + classe + '"' : "";
      if (!r) return "<tr" + cls + '><td class="l">' + rot + '</td><td colspan="4" class="l">FALHA NA LEITURA</td></tr>';
      return "<tr" + cls + '><td class="l">' + rot + "</td>" + tdN(r.pct_sec, brp(r.pct_sec) + "%") +
        ab.map(function (nm) { return tdN(r.pct_cand[nm] || 0, brp(r.pct_cand[nm] || 0) + "%" + t1(chave, nm)); }).join("") +
        tdN((r.votos[ab[0]] || 0) - (r.votos[ab[1]] || 0), txtDif(r.votos, ab[0], ab[1]), "",
            classeLider(soDois(r.votos, ab), r.numero)) + "</tr>";
    }
    return '<table class="ord" id="t-cel"><colgroup><col style="width:17%"><col style="width:16%"><col style="width:15%">' +
      '<col style="width:15%"><col style="width:37%"></colgroup><thead><tr><th>UF</th><th>Apurado</th><th>' +
      esc(curto(ab[0])) + "</th><th>" + esc(curto(ab[1])) + "</th><th>Diferença</th></tr></thead><tbody>" +
      N.UFS.map(function (uf) { return linha(ufLink(uf), m.linhas[uf], "", uf); }).join("") +
      linha(ufLink("zz", "EXTERIOR"), m.linhas.zz, "fixa", "zz") + linha(band("br") + "BRASIL", m.br, "tot", "br") + "</tbody></table>";
  }
  function avisoDivergencia(m) {
    if (!m.br) return "";
    var soma = N.PARTES.reduce(function (s, uf) { return s + ((m.linhas[uf] || {}).st || 0); }, 0);
    if (soma === m.br.st) return "";
    return '<p class="cab aviso-div"><b>ATENÇÃO:</b> o total do Brasil vem do arquivo nacional do TSE (' + br(m.br.st) +
      " seções, totalização das " + esc(m.br.hg) + "), e as regiões e os estados vêm dos arquivos estaduais, que somam " +
      br(soma) + " seções. O TSE publica o nacional e os estaduais em momentos diferentes; por isso a soma das regiões " +
      "pode não bater com a linha do Brasil até os arquivos se igualarem.</p>";
  }

  function quadroRegioes(m) {
    var ab = par(m);
    function lidera(r, nm) {
      return (r.estados || []).filter(function (uf) { return m.linhas[uf] && m.linhas[uf].lider === nm; }).length;
    }
    function leitura(x) {
      return x.r && x.r.faltam.length ? '<span class="falha">PARCIAL</span> — sem leitura de ' +
        x.r.faltam.map(function (u) { return u.toUpperCase(); }).join(", ") : "OK";
    }
    var lista = m.regioes.concat([{ nome: "TOTAL BRASIL", ufs: [], r: m.br, tot: true }]);
    var cel = lista.map(function (x, i) {
      var cls = x.tot ? ' class="tot"' : "", r = x.r, chave = x.tot ? "br" : "reg:" + i;
      var nome = '<td class="l">' + (x.tot ? "BRASIL" : esc(x.nome)) + "</td>";
      if (!r) return "<tr" + cls + ">" + nome + '<td colspan="4" class="l">FALHA NA LEITURA</td></tr>';
      return "<tr" + cls + ">" + nome + tdN(r.pct_sec, brp(r.pct_sec) + "%") +
        ab.map(function (k) { return tdN(r.pct_cand[k] || 0, brp(r.pct_cand[k] || 0) + "%" + t1(chave, k)); }).join("") +
        tdN((r.votos[ab[0]] || 0) - (r.votos[ab[1]] || 0), txtDif(r.votos, ab[0], ab[1]), "", classeLider(soDois(r.votos, ab), r.numero)) + "</tr>";
    }).join("");
    var larga = lista.map(function (x, i) {
      var cls = x.tot ? ' class="tot"' : "", r = x.r, chave = x.tot ? "br" : "reg:" + i;
      var nome = '<td class="l">' + esc(x.nome) + "</td>";
      // por região, só as siglas (sem bandeira), ainda clicáveis para abrir os municípios
      var estados = '<td class="l reg-ufs">' + (x.tot ? "27 UFs + exterior" : x.ufs.map(function (uf) {
        return '<a class="ufl" href="#cidades-' + uf + '" data-acao="cidades" data-uf="' + uf + '" title="Ver por município — ' +
          esc(nomeUf(uf)) + '">' + (uf === "zz" ? "EXTERIOR" : uf.toUpperCase()) + "</a>";
      }).join(", ")) + "</td>";
      if (!r) return "<tr" + cls + ">" + nome + estados + '<td colspan="13" class="l">FALHA NA LEITURA</td></tr>';
      var na = x.tot ? N.UFS.filter(function (uf) { return m.linhas[uf] && m.linhas[uf].lider === ab[0]; }).length : lidera(r, ab[0]);
      var nb = x.tot ? N.UFS.filter(function (uf) { return m.linhas[uf] && m.linhas[uf].lider === ab[1]; }).length : lidera(r, ab[1]);
      return "<tr" + cls + ">" + nome + estados +
        tdN(r.pct_sec, br(r.st) + " de " + br(r.ts) + "<br>" + brp(r.pct_sec) + "%", "", " qb") + tdN(r.te) +
        tdN(r.c) + tdN(r.pct_comp, brp(r.pct_comp) + "%") + tdN(r.a) + tdN(r.pct_abst, brp(r.pct_abst) + "%") + tdN(r.vv) +
        ab.map(function (k) { return tdN(r.pct_cand[k] || 0, br(r.votos[k] || 0) + "<br>" + brp(r.pct_cand[k] || 0) + "%" + t1(chave, k)); }).join("") +
        tdN((r.votos[ab[0]] || 0) - (r.votos[ab[1]] || 0), txtDif(r.votos, ab[0], ab[1]), "", classeLider(soDois(r.votos, ab), r.numero)) +
        '<td class="l">' + marca(r, r.lider) + esc(nomeLider(r.lider)) + "</td>" +
        '<td class="l">' + (x.nome === "Exterior" ? "—" : esc(curto(ab[0])) + " " + na + " · " + esc(curto(ab[1])) + " " + nb) + "</td>" +
        '<td class="l">' + (x.tot ? "OK" : leitura(x)) + "</td></tr>";
    }).join("");
    return '<div class="so-celular so-tela"><div class="rola"><table class="ord" id="t-reg-cel"><colgroup>' +
      '<col style="width:23%"><col style="width:14%"><col style="width:15%"><col style="width:15%"><col style="width:33%"></colgroup>' +
      "<thead><tr><th>Região</th><th>Apurado</th><th>" + esc(curto(ab[0])) + "</th><th>" + esc(curto(ab[1])) +
      "</th><th>Diferença</th></tr></thead><tbody>" + cel + "</tbody></table></div></div>" +
      '<div class="rola so-largo"><table class="ord medio" id="t-reg"><colgroup><col style="width:8%"><col style="width:14%">' +
      '<col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:5%"><col style="width:6%"><col style="width:5%">' +
      '<col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:5%"><col style="width:6%">' +
      '<col style="width:5%"></colgroup><thead><tr><th>Região</th><th>Estados</th><th>Seções totalizadas</th><th>Aptos</th>' +
      "<th>Compare&shy;ceram</th><th>% comp.</th><th>Abstenção</th><th>% abst.</th><th>Válidos</th><th>" + esc(curto(ab[0])) +
      "</th><th>" + esc(curto(ab[1])) + "</th><th>Diferença</th><th>Líder</th><th>Estados à frente</th><th>Leitura</th>" +
      "</tr></thead><tbody>" + larga + "</tbody></table></div>";
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
      tdN((r.proj[ab[0]] || 0) - (r.proj[ab[1]] || 0), txtDif(r.proj, ab[0], ab[1]), "",
          classeLider(soDois(r.proj, ab), r.numero || (m.br || {}).numero)) + '<td class="l">' + esc(nomeLider(lid)) + "</td></tr>";
  }
  function tabelaProjecao(m) {
    var ab = par(m);
    function pc(r) { return r ? r.pct_sec : null; }
    return '<table class="ord medio" id="t-proj"><thead><tr><th>UF</th><th>% seções</th><th>Aptos ainda por apurar</th>' +
      "<th>Votos ainda por vir</th><th>Base da taxa</th><th>Válidos projetados</th><th>" + esc(curto(ab[0])) + " projetado</th><th>" +
      esc(curto(ab[1])) + " projetado</th><th>Diferença projetada</th><th>Líder projetado</th></tr></thead><tbody>" +
      N.UFS.map(function (uf) { return linhaProj(ufLink(uf), m.linhas[uf], m, "", pc(m.linhas[uf])); }).join("") +
      linhaProj(ufLink("zz", "EXTERIOR"), m.linhas.zz, m, "fixa", pc(m.linhas.zz)) +
      linhaProj(band("br") + "TOTAL BRASIL (soma das UFs + exterior)", m.proj_br, m, "tot", pc(m.br), "soma das UFs") + "</tbody></table>";
  }
  function tabelaAlertas(m) {
    var ab = par(m), lista = alertas.slice(-60).reverse();
    if (!lista.length) return '<p class="cab">Nenhum boletim novo registrado neste navegador.</p>';
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
    return '<table class="estreito" id="t-paradas"><colgroup><col style="width:12%"><col style="width:22%"><col style="width:66%"></colgroup>' +
      "<thead><tr><th>UF</th><th>Situação</th><th>Detalhe</th></tr></thead><tbody>" + itens.map(function (i) {
        return '<tr><td class="l">' + i[0] + '</td><td class="l">' + i[1] + '</td><td class="l">' + esc(i[2]) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  function tabelaConferencia(m) {
    return '<table class="estreito" id="t-conf"><colgroup><col style="width:34%"><col style="width:18%"><col style="width:18%">' +
      '<col style="width:14%"><col style="width:16%"></colgroup><thead><tr><th>Grandeza</th><th>Arquivo do Brasil (br)</th>' +
      "<th>Soma das 27 UFs + exterior</th><th>Diferença</th><th>Situação</th></tr></thead><tbody>" + m.conf.map(function (c) {
        if (c[1] === null) return '<tr><td class="l">' + esc(c[0]) + '</td><td colspan="4" class="l">' + esc(c[3]) + "</td></tr>";
        return '<tr><td class="l">' + esc(c[0]) + "</td>" + tdN(c[1]) + tdN(c[2]) + tdN(c[2] - c[1]) + '<td class="l">' + c[3] + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  function tabelaEvolucao(m) {
    var ab = par(m), h = evolucao.slice(-40).reverse();
    if (!h.length) return '<p class="cab">Sem leituras ainda.</p>';
    return '<table class="estreito" id="t-evol"><thead><tr><th>Leitura</th><th>Totalização TSE</th><th>% seções</th><th>Seções</th>' +
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

  // ---- troca de turno e compartilhar (topo)
  function trocaTurno() {
    return '<nav class="turnos so-tela" aria-label="Turno">' + [1, 2].map(function (t) {
      return '<a href="../' + t + 'turno/"' + (CFG.turno === t ? ' class="atual" aria-current="page"' : "") + ">" + t + "º turno</a>";
    }).join("") + "</nav>";
  }
  function urlPagina() { return location.origin + location.pathname; }
  function botoesCompartilhar(m) {
    var texto = N.fraseResumo(m, CFG.turno, CFG.data_2t) + " " + urlPagina();
    return '<a class="bt-wa" href="https://wa.me/?text=' + encodeURIComponent(texto) + '" target="_blank" rel="noopener">WhatsApp</a>' +
      '<button type="button" data-acao="compartilhar">' + (navigator.share ? "Compartilhar" : "Copiar link") + "</button>";
  }
  function compartilhar(b) {
    var url = urlPagina();
    if (navigator.share) {
      navigator.share({ title: document.title, text: N.fraseResumo(M, CFG.turno, CFG.data_2t), url: url }).catch(function () {});
      return;
    }
    var ok = function () { b.textContent = "Link copiado"; setTimeout(function () { b.textContent = "Copiar link"; }, 2500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, copiaVelho);
    else copiaVelho();
    function copiaVelho() {
      var t = document.createElement("textarea");
      t.value = url; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); ok(); } catch (e) { b.textContent = url; }
      t.remove();
    }
  }

  // ---- comparação com o 1º turno (só na página do 2º turno; o 1º turno é resultado final, lido uma vez)
  var M1 = null, erroT1 = "";
  function carregaTurno1() {
    if (CFG.turno !== 2 || !CFG.eleicao_1t) return;
    var raiz1 = "https://resultados.tse.jus.br/oficial/ele2026/" + CFG.eleicao_1t + "/dados/";
    var e6 = ("000000" + CFG.eleicao_1t).slice(-6), u1 = {};
    Promise.all(N.ARQUIVOS.map(function (uf) {
      return baixaUrl(raiz1 + uf + "/" + uf + "-c0001-e" + e6 + "-u.jws").then(function (j) {
        u1[uf] = { dados: N.extrai(j), lido_em: "", falha: "" };
      }, function (e) { u1[uf] = { dados: null, lido_em: "", falha: String(e && e.message || e) }; });
    })).then(function () { M1 = N.monta(u1); if (M) desenhaPreservando(); }, function (e) { erroT1 = String(e); });
  }
  function quadroComparacao(m) {
    if (erroT1) return '<p class="cab"><b>FALHA NA LEITURA</b> do resultado do 1º turno.</p>';
    if (!M1) return '<p class="cab">Carregando o resultado do 1º turno...</p>';
    var ab = par(m), linhas = N.comparaTurnos(M1, m, ab), numero = (m.br || {}).numero;
    var pt1 = N.projecaoPeloT1(m, M1, ab);
    function celPT1(o) {
      var r = o.uf === "br" ? (pt1.br.proj ? pt1.br : null) : pt1.linhas[o.uf];
      if (!r) return '<td class="n" data-v="">—</td>';
      return tdN((r.proj[ab[0]] || 0) - (r.proj[ab[1]] || 0), txtDif(r.proj, ab[0], ab[1]), "", classeLider(soDois(r.proj, ab), numero));
    }
    function rot(o) { return o.uf === "br" ? "BRASIL" : o.uf === "zz" ? ufLink("zz", "EXTERIOR") : ufLink(o.uf); }
    function cls(o) { return o.uf === "br" ? ' class="tot"' : o.uf === "zz" ? ' class="fixa"' : ""; }
    function pp(v) { return v === null ? "—" : (v >= 0 ? "+" : "") + brp(v) + " p.p."; }
    function frente(nm, num) { return nm ? (nm === "EMPATE" ? "EMPATE" : marca({ numero: num }, nm) + esc(curto(nm))) : "—"; }
    function situ(o) {
      if (!o.lider2) return "—";
      var r2 = o.uf === "br" ? m.br : m.linhas[o.uf];
      var parcial = r2 && r2.ts && r2.st < r2.ts ? " (parcial)" : "";  // enquanto a UF não chega a 100%
      return (o.virou ? "<b>VIROU</b> para " : "mantém ") + esc(curto(o.lider2)) + parcial;
    }
    var cel = linhas.map(function (o) {
      if (o.falta) return "<tr" + cls(o) + '><td class="l">' + rot(o) + '</td><td colspan="3" class="l">FALHA NA LEITURA</td></tr>';
      return "<tr" + cls(o) + '><td class="l">' + rot(o) + "</td>" + ab.map(function (k) {
        // sem votos ainda no 2º turno: mostra o 1º turno e "—" (tdN com valor vazio apagaria o texto)
        return o.p2[k] === null ? '<td class="n" data-v="">' + brp(o.p1[k]) + "% → —</td>"
          : tdN(o.var[k], brp(o.p1[k]) + "% → " + brp(o.p2[k]) + "%");
      }).join("") + '<td class="l">' + situ(o) + "</td></tr>";
    }).join("");
    var larga = linhas.map(function (o) {
      if (o.falta) return "<tr" + cls(o) + '><td class="l">' + rot(o) + '</td><td colspan="10" class="l">FALHA NA LEITURA</td></tr>';
      return "<tr" + cls(o) + '><td class="l">' + rot(o) + "</td>" + ab.map(function (k) {
        return tdN(o.p1[k], brp(o.p1[k]) + "%") + tdN(o.p2[k], o.p2[k] === null ? "—" : brp(o.p2[k]) + "%") + tdN(o.var[k], pp(o.var[k]));
      }).join("") + '<td class="l">' + frente(o.lider1, numero) + '</td><td class="l' + (o.lider2 ? classeLider(soDois(o.uf === "br" ? m.br.votos :
        (m.linhas[o.uf] || {}).votos, ab), numero) : "") + '">' + frente(o.lider2, numero) + '</td><td class="l">' + situ(o) + "</td>" + celPT1(o) + "</tr>";
    }).join("");
    return '<p class="cab">Percentual dos votos válidos de cada um no 1º turno (04/10, com 12 candidatos) e agora. ' +
      "No 1º turno os votos se dividiam entre mais candidatos, por isso os dois tendem a subir; " +
      '"à frente" compara só os dois.</p>' +
      '<div class="so-celular so-tela"><div class="rola"><table class="ord" id="t-comp-cel"><colgroup><col style="width:17%">' +
      '<col style="width:29%"><col style="width:29%"><col style="width:25%"></colgroup><thead><tr><th>UF</th><th>' +
      esc(curto(ab[0])) + " 1º → agora</th><th>" + esc(curto(ab[1])) + " 1º → agora</th><th>Situação</th></tr></thead><tbody>" +
      cel + "</tbody></table></div></div>" +
      '<div class="rola so-largo"><table class="ord medio" id="t-comp"><thead><tr><th>UF</th>' + ab.map(function (k) {
        return "<th>" + esc(curto(k)) + " 1º turno</th><th>" + esc(curto(k)) + " agora</th><th>Variação " + esc(curto(k)) + "</th>";
      }).join("") + "<th>À frente no 1º turno</th><th>À frente agora</th><th>Situação</th>" +
      "<th>Projeção pelo 1º turno (diferença)</th></tr></thead><tbody>" + larga +
      "</tbody></table></div>";
  }

  // ---- contato da Gestor CNT: no celular o botão abre o WhatsApp; no computador o QR leva a conversa ao celular
  function quadroContato() {
    var c = CFG.contato;
    if (!c || !/^https:\/\/wa\.me\//.test(c.url || "")) return "";
    return '<div class="cartao contato so-tela"><img class="qr" src="' + esc(c.qr) + '" alt="QR code do WhatsApp da Gestor CNT" ' +
      'width="120" height="120"><div><div class="rotulo">Fale com a gente</div><div class="contato-titulo">' + esc(c.texto) +
      '</div><div class="sub">Aponte a câmera do celular para o código ou toque no botão.</div>' +
      '<a class="bt-contato" href="' + esc(c.url) + '" target="_blank" rel="noopener">Abrir no WhatsApp</a></div></div>';
  }

  var M = null, agoraUlt = null, falta = INTERVALO;
  function desenha() {
    var m = M, agora = agoraUlt;
    var falhas = N.ARQUIVOS.filter(function (u) { return m.leitura[u].falha; }).map(function (u) { return u.toUpperCase(); });
    var conc = m.br && m.br.ts && m.br.st >= m.br.ts;
    var vivo = !conc || alertas.length > 0 || evolucao.length > 1;  // apuração já encerrada ao abrir: sem esses quadros
    var conf = m.conf.every(function (c) { return c[3] === "OK"; }) ? "CONFERÊNCIA OK" :
      (m.conf.some(function (c) { return c[3] === "DIVERGENTE"; }) ? "CONFERÊNCIA DIVERGENTE" : "CONFERÊNCIA NÃO VERIFICÁVEL");
    var dataHora = agora.toLocaleDateString("pt-BR") + " " + hora(agora);
    document.getElementById("conteudo").innerHTML =
      '<header class="barra so-tela"><div><div class="sobre">' + esc(CFG.rotulo) + '</div>' +
      '<div class="titulo">Apuração por estado</div><div class="vivo"><span class="estado">' + (conc ? "ENCERRADO" : "AO VIVO") +
      "</span>" + esc(situacao(m)) + ' · leitura <span id="hora-leitura">' + hora(agora) + "</span>" + (conc ? "" : ' · nova leitura em <b id="contador">' + falta + " s</b>") +
      '</div><div class="vivo">Fonte: TSE (resultados oficiais e fotos) · falhas de leitura: ' + (falhas.join(", ") || "nenhuma") +
      " · " + conf + '</div></div>' + trocaTurno() + '<div class="botoes">' + botoesCompartilhar(m) +
      '<button type="button" data-acao="pdf">Imprimir / PDF</button>' +
      '<button type="button" data-acao="csv">Exportar CSV</button><button type="button" data-acao="limpa-ordem">Ordem original</button></div></header>' +
      '<div class="so-papel"><h1>' + esc(CFG.titulo) + '</h1><p class="cab">Fonte: TSE, ' +
      "resultados.tse.jus.br (ambiente oficial), eleição " + esc(CFG.eleicao) + ". Leitura: <b>" + dataHora + "</b>.</p>" +
      '<p class="cab">Situação: <b>' + esc(situacao(m)) + "</b>. Leituras com falha: <b>" + (falhas.join(", ") || "nenhuma") + "</b>.</p>" +
      '<p class="cab">' + esc(N.fraseResumo(m, CFG.turno, CFG.data_2t)) + "</p></div>" +
      '<div class="frase so-tela">' + esc(N.fraseResumo(m, CFG.turno, CFG.data_2t)) + "</div>" +
      publicidade() +
      '<section class="so-tela">' + painelBrasil(m) + "</section>" + quadroContato() +
      (m.ordem.length > 2 ? '<h2>Todos os candidatos</h2><div class="rola">' + rankingCandidatos(m) + "</div>" : "") +
      '<h2 class="so-papel">Brasil</h2><div class="rola so-papel">' + resumoPapel(m) + "</div>" +
      "<h2>Por região</h2>" + avisoDivergencia(m) + legendaT1() + quadroRegioes(m) +
      "<h2>Por estado</h2>" + legendaT1() + '<div class="so-celular so-tela"><div class="rola">' + tabelaCelular(m) + "</div>" +
      '<button type="button" class="botao-completa" data-acao="completa">Ver tabela completa</button></div>' +
      '<div class="rola so-largo">' + tabelaUfs(m) + "</div>" +
      (CFG.turno === 2 ? "<h2>Comparação com o 1º turno</h2>" + quadroComparacao(m) : "") +
      (CFG.presos ? '<h2>Votação em presídios e unidades de internação (presos provisórios)</h2><div id="presos-area">' +
        htmlPresos() + "</div>" : "") +
      (conc ? "" : '<h2>Projeção do resultado final por estado (ESTIMATIVA)</h2><div class="rola">' + tabelaProjecao(m) + "</div>") +
      (vivo ? '<h2>Alertas de boletins novos (registrados neste navegador)</h2><div class="rola">' + tabelaAlertas(m) + "</div>" : "") +
      "<h2>Estados sem totalização ou parados há mais de " + CFG.parada_min + ' minutos</h2><div class="rola">' + quadroParadas(m) + "</div>" +
      '<h2>Conferência: Brasil × soma dos estados</h2><div class="rola">' + tabelaConferencia(m) + "</div>" +
      '<p class="cab">Os arquivos do TSE são publicados um a um; por alguns segundos a soma pode divergir do total do Brasil ' +
      "sem que haja erro — a divergência que persiste em várias leituras é a que importa.</p>" +
      (vivo ? '<h2>Evolução no Brasil (registrada neste navegador)</h2><div class="rola">' + tabelaEvolucao(m) + "</div>" : "") +
      '<p class="rod"><b>Como ler.</b> Seções totalizadas e % do eleitorado totalizado são medidas diferentes: a primeira conta ' +
      "urnas; a segunda, eleitores aptos das seções já totalizadas. Compareceram, abstenção, brancos e nulos referem-se apenas às " +
      "seções já totalizadas; a abstenção é eleitorado das seções totalizadas − comparecimento. <b>Aptos ainda por apurar " +
      "(OFICIAL)</b> = aptos − eleitorado das seções totalizadas (dado do TSE). <b>Votos ainda por vir (ESTIMATIVA)</b> = aptos " +
      "ainda por apurar × comparecimento atual da UF (sem seção totalizada, o do Brasil, marcado \"taxa BR\"). <b>Projeção</b> = " +
      "votos atuais + votos por vir × proporção de válidos × fatia atual de cada candidato, UF por UF. Estimativa, não resultado. " +
      "Os números vêm direto dos arquivos públicos do TSE, lidos pelo seu navegador a cada minuto; este site não é do TSE.</p>" +
      '<p class="rod aviso-direitos">© 2026 eleicoes.gestorcnt.com — textos, código e leiaute protegidos pela Lei 9.610/98. ' +
      "É proibido copiar o site ou usá-lo para treinar ou alimentar sistemas de inteligência artificial sem autorização. " +
      "Os resultados são dados públicos do TSE.</p>";
    aplica();
  }

  // ---- consulta por município (clique na bandeira/sigla da UF)
  // Votos: um arquivo do TSE por município ({uf}{cd}-c0001-e{ele}-u.jws), lidos 12 por vez só quando a tela abre.
  // Depois, a cada 2 min, lê o consolidado do estado ({uf}-e{ele}-ab.jws: seções e horário por município) e
  // baixa de novo só as cidades que mudaram. Nomes: municipios/{uf}.json, tirado da lista oficial do TSE.
  var CID = { uf: "", nomes: null, dados: {}, ab: {}, timer: null, filtro: "", lidos: 0, total: 0, leitura: "" };
  function semAcento(t) { return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
  function fila(itens, n, fn, prog) {
    return new Promise(function (ok) {
      var i = 0, ativos = 0, feitos = 0;
      if (!itens.length) { ok(); return; }
      function proximo() {
        if (i >= itens.length) { if (!ativos) ok(); return; }
        var it = itens[i++];
        ativos++;
        fn(it).then(function () { ativos--; feitos++; if (prog) prog(feitos, itens.length); proximo(); });
      }
      for (var k = 0; k < Math.min(n, itens.length); k++) proximo();
    });
  }
  function nomeUf(uf) { return uf === "zz" ? "Exterior" : CFG.nome_uf[uf]; }
  function abreCidades(uf, semHistorico) {
    if (!/^[a-z]{2}$/.test(uf) || (uf !== "zz" && !CFG.nome_uf[uf])) return;
    clearTimeout(CID.timer);
    CID = { uf: uf, nomes: null, dados: {}, ab: {}, timer: null, filtro: "", lidos: 0, total: 0, leitura: "" };
    if (!semHistorico) { try { history.pushState({ cidades: uf }, "", "#cidades-" + uf); } catch (e) {} }
    var el = document.getElementById("cidades");
    el.innerHTML = '<header class="barra so-tela"><div><div class="sobre">' + esc(CFG.rotulo) + '</div><div class="titulo">' +
      (uf === "zz" ? "" : band(uf)) + esc(nomeUf(uf)) + ' — por município</div><div class="vivo" id="cid-status">Carregando...</div></div>' +
      '<div class="botoes"><button type="button" data-acao="fecha-cidades">Voltar aos estados</button></div></header>' +
      '<div class="so-papel"><h1>' + esc(CFG.titulo) + " — " + esc(nomeUf(uf)) + ' por município</h1><p class="cab" id="cid-status-papel"></p></div>' +
      '<div class="cid-busca so-tela"><input type="search" id="busca-mun" placeholder="Buscar município" autocomplete="off"></div>' +
      '<div id="cid-corpo"><p class="carregando">Carregando a lista de municípios...</p></div>';
    document.body.classList.add("com-cidades");
    el.classList.add("aberto");
    el.scrollTop = 0;
    fetch("municipios/" + uf + ".json").then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (lista) {
        if (CID.uf !== uf) return;
        CID.nomes = lista;
        CID.total = lista.length;
        return atualizaCidades(uf, true);
      })
      .catch(function (e) {
        if (CID.uf === uf) document.getElementById("cid-corpo").innerHTML =
          '<p class="carregando"><b>FALHA NA LEITURA</b> da lista de municípios (' + esc(e.message || e) + ").</p>";
      });
  }
  function fechaCidades() {
    clearTimeout(CID.timer);
    CID.uf = "";
    document.body.classList.remove("com-cidades");
    var el = document.getElementById("cidades");
    el.classList.remove("aberto");
    el.innerHTML = "";
  }
  function atualizaCidades(uf, primeira) {
    var todos = CID.nomes.map(function (c) { return c[0]; });
    return baixaUrl(RAIZ + "/dados/" + uf + "/" + uf + "-e" + ELE6 + "-ab.jws").then(function (j) {
      var mudou = [];
      (j.abr || []).forEach(function (a) {
        var chave = ((a.s || {}).st || "") + "|" + (a.dt || "") + " " + (a.ht || "");
        if (CID.ab[a.cdabr] !== chave) { CID.ab[a.cdabr] = chave; mudou.push(a.cdabr); }
      });
      return mudou;
    }, function () { return todos; }).then(function (mudou) {
      if (CID.uf !== uf) return;
      var alvo = primeira ? todos : todos.filter(function (cd) {
        return mudou.indexOf(cd) >= 0 || !CID.dados[cd] || CID.dados[cd].falha;
      });
      var ultimo = 0;
      return fila(alvo, 12, function (cd) {
        return baixaUrl(RAIZ + "/dados/" + uf + "/" + uf + cd + "-c0001-e" + ELE6 + "-u.jws").then(function (j) {
          CID.dados[cd] = { d: N.extrai(j), falha: "" };
        }, function (e) {
          var ant = CID.dados[cd] || {};
          CID.dados[cd] = { d: ant.d || null, falha: String(e && e.message || e) };
        });
      }, function (feitos, total) {
        if (CID.uf !== uf) return;
        if (primeira) {
          CID.lidos = feitos;
          if (feitos - ultimo >= 60 || feitos === total) { ultimo = feitos; desenhaCidades(); }
          else statusCidades();
        }
      }).then(function () {
        if (CID.uf !== uf) return;
        CID.lidos = Object.keys(CID.dados).length;
        CID.leitura = hora(new Date());
        desenhaCidades();
        var conc = M && M.br && M.br.ts && M.br.st >= M.br.ts;
        if (!conc) CID.timer = setTimeout(function () { if (CID.uf === uf) atualizaCidades(uf, false); }, 120000);
      });
    });
  }
  function statusCidades() {
    var falhas = Object.keys(CID.dados).filter(function (cd) { return CID.dados[cd].falha; }).length;
    var conc = M && M.br && M.br.ts && M.br.st >= M.br.ts;
    var txt = "Municípios lidos: " + br(CID.lidos) + " de " + br(CID.total) +
      (falhas ? " · FALHA NA LEITURA em " + falhas + " (valor anterior mantido)" : "") +
      (CID.leitura ? " · leitura " + CID.leitura + (conc ? "" : " · atualiza a cada 2 min") : " · carregando...");
    var a = document.getElementById("cid-status"), b = document.getElementById("cid-status-papel");
    if (a) a.textContent = txt;
    if (b) b.textContent = "Fonte: TSE, arquivos por município. " + txt;
  }
  function desenhaCidades() {
    var corpo = document.getElementById("cid-corpo");
    if (!corpo || !M) return;
    var ab = par(M), uf = CID.uf, ruf = M.linhas[uf];
    var lin = CID.nomes.map(function (c) {
      var x = CID.dados[c[0]];
      return { cd: c[0], nome: c[1], r: x && x.d ? N.calcula(x.d) : null, falha: x ? x.falha : "" };
    });
    function celDif(r) {
      return tdN((r.votos[ab[0]] || 0) - (r.votos[ab[1]] || 0), txtDif(r.votos, ab[0], ab[1]), "", classeLider(soDois(r.votos, ab), r.numero));
    }
    function situ(x) {
      return x.falha ? (x.r ? '<span class="falha">FALHA NA LEITURA — valor anterior</span>' : '<span class="falha">FALHA NA LEITURA</span>') : "OK";
    }
    var cel = lin.map(function (x) {
      var nm = '<td class="l" data-nome="' + esc(semAcento(x.nome)) + '">' + esc(x.nome) + "</td>";
      if (!x.r) return "<tr>" + nm + '<td colspan="4" class="l">' + (x.falha ? "FALHA NA LEITURA" : "carregando...") + "</td></tr>";
      var r = x.r;
      return "<tr>" + nm + tdN(r.pct_sec, brp(r.pct_sec) + "%") +
        ab.map(function (k) { return tdN(r.pct_cand[k] || 0, brp(r.pct_cand[k] || 0) + "%"); }).join("") + celDif(r) + "</tr>";
    }).join("");
    var larga = lin.map(function (x) {
      var nm = '<td class="l" data-nome="' + esc(semAcento(x.nome)) + '">' + esc(x.nome) + "</td>";
      if (!x.r) return "<tr>" + nm + '<td colspan="15" class="l">' + (x.falha ? situ(x) : "carregando...") + "</td></tr>";
      var r = x.r;
      return "<tr>" + nm + tdN(r.pct_sec, br(r.st) + " de " + br(r.ts) + "<br>" + brp(r.pct_sec) + "%") + tdN(r.te) + tdN(r.c) +
        tdN(r.pct_comp, brp(r.pct_comp) + "%") + tdN(r.a) + tdN(r.pct_abst, brp(r.pct_abst) + "%") + tdN(r.vv) + tdN(r.vb) + tdN(r.tvn) +
        ab.map(function (k) { return tdN(r.pct_cand[k] || 0, br(r.votos[k] || 0) + "<br>" + brp(r.pct_cand[k] || 0) + "%"); }).join("") +
        celDif(r) + '<td class="l">' + marca(r, r.lider) + esc(nomeLider(r.lider)) + "</td>" +
        '<td class="n">' + esc(r.hg) + '</td><td class="l">' + situ(x) + "</td></tr>";
    }).join("");
    var resumo = ruf ? '<p class="cab cid-resumo"><b>' + esc(nomeUf(uf)) + ":</b> " + brp(ruf.pct_sec) + "% das seções · " +
      ab.map(function (k) { return esc(curto(k)) + " " + brp(ruf.pct_cand[k] || 0) + "%"; }).join(" × ") + " · " +
      txtDif(ruf.votos, ab[0], ab[1]) + " · líder " + esc(nomeLider(ruf.lider)) + "</p>" : "";
    corpo.innerHTML = resumo +
      '<div class="so-celular so-tela"><div class="rola"><table class="ord" id="t-mun-cel"><colgroup><col style="width:34%">' +
      '<col style="width:14%"><col style="width:13%"><col style="width:13%"><col style="width:26%"></colgroup><thead><tr>' +
      "<th>Município</th><th>Apurado</th><th>" + esc(curto(ab[0])) + "</th><th>" + esc(curto(ab[1])) + "</th><th>Diferença</th>" +
      "</tr></thead><tbody>" + cel + "</tbody></table></div>" +
      '<button type="button" class="botao-completa" data-acao="completa">Ver tabela completa</button></div>' +
      '<div class="rola so-largo"><table class="ord" id="t-mun"><colgroup><col style="width:14%"><col style="width:7%">' +
      '<col style="width:6%"><col style="width:6%"><col style="width:5%"><col style="width:6%"><col style="width:5%"><col style="width:6%">' +
      '<col style="width:5%"><col style="width:5%"><col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:5%">' +
      '<col style="width:5%"><col style="width:4%"></colgroup><thead><tr><th>Município</th><th>Seções totalizadas</th><th>Aptos</th>' +
      "<th>Compare&shy;ceram</th><th>% comp.</th><th>Abstenção</th><th>% abst.</th><th>Válidos</th><th>Brancos</th><th>Nulos</th><th>" +
      esc(curto(ab[0])) + "</th><th>" + esc(curto(ab[1])) + "</th><th>Diferença</th><th>Líder</th><th>Última totaliz.</th>" +
      "<th>Leitura</th></tr></thead><tbody>" + larga + "</tbody></table></div>";
    statusCidades();
    filtraCidades();
    aplica();
  }
  function filtraCidades() {
    var q = semAcento(CID.filtro).trim();
    document.querySelectorAll("#t-mun-cel tbody tr, #t-mun tbody tr").forEach(function (tr) {
      var nm = tr.cells[0].getAttribute("data-nome") || "";
      tr.style.display = !q || nm.indexOf(q) >= 0 ? "" : "none";
    });
  }
  document.addEventListener("input", function (ev) {
    if (ev.target && ev.target.id === "busca-mun") { CID.filtro = ev.target.value; filtraCidades(); }
  });
  window.addEventListener("popstate", function () {
    var h = /^#cidades-([a-z]{2})$/.exec(location.hash);
    if (h) abreCidades(h[1], true); else if (CID.uf) fechaCidades();
  });

  // ---- votação em presídios e unidades de internação (seções de "Preso provisório" do cadastro do TSE)
  // Lista em presos.json (gerada do cadastro oficial); votos do boletim de urna de cada seção, lidos 12 por
  // vez só quando a pessoa abre o quadro; durante a apuração relê a cada 5 min as seções ainda sem boletim.
  var PRE = { lista: null, dados: {}, carregando: false, lidos: 0, timer: null, leitura: "", erro: "" };
  var RAIZ_URNA = "https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/" + CFG.pleito;
  var PLEITO6 = ("000000" + CFG.pleito).slice(-6);
  function chaveSec(x) { return x.uf + x.mun + x.z + x.s; }
  function abrePresos() {
    if (PRE.carregando || PRE.lista) return;
    PRE.carregando = true;
    desenhaPresos();
    fetch("presos.json").then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { PRE.lista = j.secoes || []; return carregaPresos(true); })
      .catch(function (e) { PRE.erro = String(e && e.message || e); PRE.carregando = false; desenhaPresos(); });
  }
  function carregaPresos(primeira) {
    PRE.carregando = true;
    PRE.lista.forEach(function (x) { if (x.pr) PRE.dados[chaveSec(x)] = { r: null, falha: "", st: "agregada" }; });
    var alvo = PRE.lista.filter(function (x) {
      var d = PRE.dados[chaveSec(x)];
      return !x.pr && (primeira || !d || !d.r || d.falha);
    });
    var ultimo = 0;
    return fila(alvo, 12, function (x) {
      var base = RAIZ_URNA + "/dados/" + x.uf + "/" + x.mun + "/" + x.z + "/" + x.s + "/";
      return buscaCom(base + "p" + PLEITO6 + "-" + x.uf + "-m" + x.mun + "-z" + x.z + "-s" + x.s + "-aux.json", "json")
        .then(function (aux) {
          var h = (aux.hashes || []).filter(function (y) { return y.st === "Recebido" || y.st === "Totalizado"; })[0];
          var arq = h && (h.arq || []).filter(function (a) { return a.tp === "bu"; })[0];
          if (!arq) { PRE.dados[chaveSec(x)] = { r: null, falha: "", st: "aguardando" }; return; }
          return buscaCom(base + h.hash + "/" + arq.nm, "bin").then(function (bytes) {
            var r = N.resumoBoletim(N.boletim(bytes), Number(CFG.eleicao), (M.br || {}).numero);
            PRE.dados[chaveSec(x)] = { r: r, falha: r ? "" : "boletim sem Presidente", st: h.st };
          });
        }).catch(function (e) {
          var ant = PRE.dados[chaveSec(x)] || {};
          PRE.dados[chaveSec(x)] = e && e.http === 404 ? { r: ant.r || null, falha: "", st: "aguardando" }
            : { r: ant.r || null, falha: String(e && e.message || e), st: ant.st || "" };
        });
    }, function (feitos, total) {
      PRE.lidos = feitos;
      if (feitos - ultimo >= 25 || feitos === total) { ultimo = feitos; desenhaPresos(); }
    }).then(function () {
      PRE.carregando = false;
      PRE.leitura = hora(new Date());
      desenhaPresos();
      var conc = M && M.br && M.br.ts && M.br.st >= M.br.ts;
      var faltam = PRE.lista.some(function (x) { var d = PRE.dados[chaveSec(x)]; return !x.pr && (!d || !d.r); });
      clearTimeout(PRE.timer);
      if (!conc || faltam) PRE.timer = setTimeout(function () { carregaPresos(false); }, 300000);
    });
  }
  function somaPresos(itens) {
    var t = { secoes: itens.filter(function (x) { return !x.pr; }).length, lidas: 0, aptos: 0, c: 0, vb: 0, tvn: 0, vv: 0, votos: {} };
    itens.forEach(function (x) {
      var d = PRE.dados[chaveSec(x)];
      if (!d || !d.r) return;
      t.lidas++; t.aptos += d.r.aptos; t.c += d.r.c; t.vb += d.r.vb; t.tvn += d.r.tvn; t.vv += d.r.vv;
      Object.keys(d.r.votos).forEach(function (nm) { t.votos[nm] = (t.votos[nm] || 0) + d.r.votos[nm]; });
    });
    return t;
  }
  function htmlPresos() {
    var nota = '<p class="cab">Seções especiais instaladas em estabelecimentos penais e unidades de internação de adolescentes ' +
      '(tipo de local "Preso provisório" no cadastro oficial do TSE). Votos lidos do boletim de urna de cada seção.</p>';
    if (PRE.erro) return nota + '<p class="cab"><b>FALHA NA LEITURA</b> da lista de seções (' + esc(PRE.erro) + ").</p>";
    if (!PRE.lista) {
      return nota + '<button type="button" class="botao-presos naoimprime" data-acao="presos">' +
        (PRE.carregando ? "Carregando..." : "Ver a votação nos presídios e unidades de internação") + "</button>";
    }
    if (!M) return nota;
    var ab = par(M), numero = (M.br || {}).numero;
    var ufs = [];
    PRE.lista.forEach(function (x) { if (ufs.indexOf(x.uf) < 0) ufs.push(x.uf); });
    var tot = somaPresos(PRE.lista);
    function cand(t, k) { return tdN(N.pct(t.votos[k] || 0, t.vv), br(t.votos[k] || 0) + "<br>" + brp(N.pct(t.votos[k] || 0, t.vv)) + "%"); }
    function dif(t) {
      return tdN((t.votos[ab[0]] || 0) - (t.votos[ab[1]] || 0), txtDif(t.votos, ab[0], ab[1]), "", classeLider(soDois(t.votos, ab), numero));
    }
    function linhaUfP(rot, t, cls) {
      return "<tr" + (cls ? ' class="' + cls + '"' : "") + '><td class="l">' + rot + "</td>" +
        tdN(t.lidas, br(t.lidas) + " de " + br(t.secoes)) + tdN(t.aptos) + tdN(N.pct(t.c, t.aptos), br(t.c) + "<br>" + brp(N.pct(t.c, t.aptos)) + "%") +
        cand(t, ab[0]) + cand(t, ab[1]) + tdN(t.vb) + tdN(t.tvn) + dif(t) + "</tr>";
    }
    var resumo = ufs.map(function (uf) {
      return linhaUfP(band(uf) + uf.toUpperCase(), somaPresos(PRE.lista.filter(function (x) { return x.uf === uf; })));
    }).join("") + linhaUfP("BRASIL", tot, "tot");
    var detalhe = PRE.lista.map(function (x) {
      var d = PRE.dados[chaveSec(x)] || {}, r = d.r;
      var ini = '<tr><td class="l">' + esc(x.lc) + '</td><td class="l">' + x.uf.toUpperCase() + '</td><td class="l">' + esc(x.mn) +
        '</td><td class="n">' + Number(x.z) + " / " + Number(x.s) + "</td>";
      var situ = d.falha ? '<span class="falha">FALHA NA LEITURA</span>' + (r ? " — valor anterior" : "")
        : (r ? (d.st === "Totalizado" ? "TOTALIZADO" : "RECEBIDO") : (x.pr ? "AGREGADA à seção " + Number(x.pr) + " — votos no boletim dela"
          : (d.st === "aguardando" ? "AGUARDANDO BOLETIM" : "carregando...")));
      if (!r) return ini + '<td colspan="8" class="l">' + situ + "</td></tr>";
      var t = { votos: r.votos, vv: r.vv };
      return ini + tdN(r.aptos) + tdN(N.pct(r.c, r.aptos), br(r.c) + "<br>" + brp(N.pct(r.c, r.aptos)) + "%") +
        cand(t, ab[0]) + cand(t, ab[1]) + tdN(r.vb) + tdN(r.tvn) + dif(t) + '<td class="l">' + situ + "</td></tr>";
    }).join("");
    var agregadas = PRE.lista.filter(function (x) { return x.pr; }).length;
    var status = "Boletins lidos: " + br(tot.lidas) + " de " + br(PRE.lista.length - agregadas) + " seções" +
      (agregadas ? " (mais " + agregadas + " agregada" + (agregadas > 1 ? "s" : "") + " a outra seção, sem boletim próprio)" : "") +
      (PRE.carregando ? " · lendo... (" + br(PRE.lidos) + ")" : (PRE.leitura ? " · leitura " + PRE.leitura : ""));
    return nota + '<p class="cab"><b>' + status + "</b></p>" +
      '<div class="rola"><table class="ord estreito" id="t-presos-uf"><thead><tr><th>UF</th><th>Seções com boletim</th>' +
      "<th>Aptos</th><th>Compareceram</th><th>" + esc(curto(ab[0])) + "</th><th>" + esc(curto(ab[1])) + "</th><th>Brancos</th>" +
      "<th>Nulos</th><th>Diferença</th></tr></thead><tbody>" + resumo + "</tbody></table></div>" +
      '<h3 class="presos-h3">Por seção</h3><div class="rola"><table class="ord medio" id="t-presos"><colgroup><col style="width:22%">' +
      '<col style="width:5%"><col style="width:13%"><col style="width:8%"><col style="width:6%"><col style="width:8%"><col style="width:8%">' +
      '<col style="width:8%"><col style="width:5%"><col style="width:5%"><col style="width:7%"><col style="width:9%"></colgroup><thead><tr>' +
      "<th>Local de votação</th><th>UF</th><th>Município</th><th>Zona / Seção</th><th>Aptos</th><th>Compareceram</th><th>" +
      esc(curto(ab[0])) + "</th><th>" + esc(curto(ab[1])) + "</th><th>Brancos</th><th>Nulos</th><th>Diferença</th><th>Boletim</th>" +
      "</tr></thead><tbody>" + detalhe + "</tbody></table></div>";
  }
  function desenhaPresos() {
    var el = document.getElementById("presos-area");
    if (el) { el.innerHTML = htmlPresos(); aplica(); }
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
    a.download = CFG.arquivo + "_" + agora.getFullYear() + "-" + p(agora.getMonth() + 1) + "-" + p(agora.getDate()) +
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
    if (acao === "cidades") { ev.preventDefault(); abreCidades(b.getAttribute("data-uf")); return; }
    if (acao === "presos") { abrePresos(); return; }
    if (acao === "fecha-cidades") {
      if (history.state && history.state.cidades) history.back(); else fechaCidades();
      return;
    }
    if (acao === "compartilhar") { compartilhar(b); return; }
    if (acao === "pdf") window.print();
    else if (acao === "csv") csv();
    else if (acao === "completa") { document.body.classList.toggle("completa"); aplica(); }
    else if (acao === "limpa-ordem") {
      est = {};
      try { sessionStorage.removeItem(CHAVE); } catch (x) {}
      desenha();
    }
  });

  var ultimaAssinatura = "";
  function assinatura() {
    return N.ARQUIVOS.map(function (uf) {
      var u = ultimo[uf] || {}, d = u.dados || {};
      return [d.dg, d.hg, d.st, d.tv, u.falha ? 1 : 0].join("|");
    }).join(";");
  }
  function desenhaPreservando() {
    var rolagem = {};
    document.querySelectorAll("#conteudo .rola").forEach(function (r) {
      var t = r.querySelector("table[id]");
      if (t && r.scrollLeft) rolagem[t.id] = r.scrollLeft;
    });
    desenha();
    Object.keys(rolagem).forEach(function (id) {
      var t = document.getElementById(id);
      if (t && t.parentElement) t.parentElement.scrollLeft = rolagem[id];
    });
  }
  function rodada() {
    ciclo().then(function (agora) {
      var primeira = !M;
      M = N.monta(ultimo); agoraUlt = agora;
      registra(M, agora);
      falta = INTERVALO;
      var sig = assinatura();
      if (primeira || sig !== ultimaAssinatura) { ultimaAssinatura = sig; desenhaPreservando(); }
      else { var hl = document.getElementById("hora-leitura"); if (hl) hl.textContent = hora(agora); }
      var h = /^#cidades-([a-z]{2})$/.exec(location.hash);
      if (primeira && h) abreCidades(h[1], true);
      else if (CID.uf && CID.nomes) statusCidades();
      var conc = M.br && M.br.ts && M.br.st >= M.br.ts;
      if (!conc) setTimeout(rodada, INTERVALO * 1000);
    });
  }
  setInterval(function () {
    var el = document.getElementById("contador");
    if (el && falta > 1) { falta -= 1; el.textContent = falta + " s"; }
  }, 1000);
  rodada();
  carregaTurno1();
})(NUCLEO);
