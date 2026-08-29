/* Eleições CE · BA — consulta pública sobre dados estáticos do TSE.
   Tudo roda no navegador: os arquivos em /d são baixados sob demanda e
   ficam em cache; não há servidor de aplicação. */
"use strict";

var idx = null;
var cacheArq = {};
var estado = {ano: "2022", uf: "BA", pagina: null, turno: 1, mun: "",
              sel: {}, selEst: null, selFed: null, ultimo: null,
              muns: []};
var MAX_MUN = 4;   // municípios no comparativo entre municípios
var CARGO_REF = {"2020": 11, "2022": 3, "2024": 11};
var reqAtual = 0;
var buscaSeq = 0;            // sequência da busca de candidatos
var buscaTimer = null;       // debounce da busca (cancelado ao trocar de página)
var MAX_SEL = 6;   // comparação legível e rápida de desenhar
var modoMapa = "votos";      // votos | percentual | ranking | calor | abstencao
var ordemCusto = "votos";    // votos | custo_menor | custo_maior | despesa
var DIM_TITULO = {genero: "Gênero", faixa: "Faixa etária",
                  escol: "Escolaridade"};
var mapaLeaflet = null;      // instância viva do Leaflet
var CORES_RANKING = ["#6366F1", "#F59E0B", "#10B981", "#EF4444",
                     "#0EA5E9", "#8B5CF6"];

// ao entrar/sair da tela inteira o container muda de tamanho — o
// Leaflet precisa remedir, senão os tiles ficam pela metade
document.addEventListener("fullscreenchange", function(){
  if(mapaLeaflet){
    setTimeout(function(){ mapaLeaflet.invalidateSize(); }, 120);
  }
});
document.addEventListener("keydown", function(ev){
  if(ev.key !== "Escape") return;
  var cxm = document.getElementById("mapa-caixa");
  if(cxm && cxm.classList.contains("tela-cheia")){
    cxm.classList.remove("tela-cheia");
    if(mapaLeaflet)
      setTimeout(function(){ mapaLeaflet.invalidateSize(); }, 120);
  }
});

function el(id){ return document.getElementById(id); }
function num(v){ return (v === null || v === undefined) ? "—"
  : Number(v).toLocaleString("pt-BR"); }
function pct(a, b){ if(!b) return "—";
  return (100*a/b).toLocaleString("pt-BR",
    {minimumFractionDigits:1, maximumFractionDigits:1}) + "%"; }
function dinheiro(v){ return (v === null || v === undefined) ? "—"
  : "R$ " + Number(v).toLocaleString("pt-BR",
    {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
function esc(t){ var d = document.createElement("div");
  d.textContent = (t === null || t === undefined) ? "" : String(t);
  return d.innerHTML; }
function situHtml(s){ if(!s) return "";
  var cls = (String(s).toUpperCase().indexOf("ELEITO") === 0)
    ? "situ situ-eleito" : "situ situ-outro";
  return '<span class="' + cls + '">' + esc(s) + "</span>"; }
function barra(v, max){
  var w = max ? Math.max(1, Math.round(100*v/max)) : 0;
  return '<div class="barra" style="width:' + w + '%"></div>';
}
function kpi(total, rotulo){
  return '<div class="cartao"><div class="kpi">' + num(total) +
    '</div><div class="kpi-rotulo">' + esc(rotulo) + "</div></div>";
}
function aviso(txt){
  var a = el("pg-aviso");
  if(txt){ a.textContent = txt; a.classList.remove("oculto"); }
  else a.classList.add("oculto");
}
function carregando(){
  // matar o mapa ANTES de destacar o container: remove() com o div
  // fora do DOM deixa a animação do Leaflet estourar _leaflet_pos
  if(mapaLeaflet){ mapaLeaflet.remove(); mapaLeaflet = null; }
  el("pg-tabela").innerHTML =
    '<div class="carregando">Carregando dados…</div>';
  el("pg-lateral").innerHTML = "";
}

/* ---------------- carga de arquivos (com cache) ---------------- */
function pega(caminho){
  if(cacheArq[caminho]) return cacheArq[caminho];
  var p = fetch(caminho).then(function(r){
    if(!r.ok){
      var e = new Error("sem dados");
      e.semDados = true;
      throw e;
    }
    return r.json();
  }).catch(function(e){
    delete cacheArq[caminho];   // erro não pode ficar cacheado
    throw e;
  });
  cacheArq[caminho] = p;
  return p;
}
function arqRk(){
  var p = paginaAtual();
  return "d/rk/" + estado.ano + "_" + estado.uf + "_" +
    (p.cargo || 7) + "_" + estado.turno + ".json";
}
function arqMn(cargo){
  return "d/mn/" + estado.ano + "_" + estado.uf + "_" + cargo + "_" +
    estado.turno + ".json";
}
function arqSc(cargo, mun){
  return "d/sc/" + mun + "_" + estado.ano + "_" + cargo + "_" +
    estado.turno + ".json";
}

/* ---------------- páginas ---------------- */
function paginas(){
  var pgs = [];
  var cargos = idx.pleitos[estado.ano] || [];
  cargos.forEach(function(c){
    pgs.push({id: "rk" + c, tipo: "ranking", cargo: c,
              titulo: idx.cargos[c]});
    if(c === 6 || c === 7){
      pgs.push({id: "cid" + c, tipo: "cidade", cargo: c,
                titulo: idx.cargos[c] + " POR CIDADE"});
    }
    pgs.push({id: "sec" + c, tipo: "secao", cargo: c,
              titulo: idx.cargos[c] + " POR SEÇÃO"});
    pgs.push({id: "cmp" + c, tipo: "comparativo", cargo: c,
              titulo: idx.cargos[c] + " COMPARATIVO"});
    pgs.push({id: "map" + c, tipo: "mapa", cargo: c,
              titulo: idx.cargos[c] + " MAPA"});
    pgs.push({id: "cv" + c, tipo: "custo", cargo: c,
              titulo: idx.cargos[c] + " CUSTO DO VOTO"});
    pgs.push({id: "pv" + c, tipo: "perfilvoto", cargo: c,
              titulo: idx.cargos[c] + " PERFIL DO VOTO"});
    if(c === 11 || c === 13){
      pgs.push({id: "ev" + c, tipo: "evolucao", cargo: c,
                titulo: idx.cargos[c] + " EVOLUÇÃO 2020→2024"});
    }
  });
  if(estado.ano === "2022"){
    pgs.push({id: "comb", tipo: "combinado", cargo: 0,
              titulo: "FEDERAL E ESTADUAL POR CIDADE"});
    pgs.push({id: "casad", tipo: "casadinha", cargo: 7,
              titulo: "CASADINHA ESTADUAL × FEDERAL"});
  }
  pgs.push({id: "pan", tipo: "panorama", cargo: 0,
            titulo: "PANORAMA DO MUNICÍPIO"});
  pgs.push({id: "cmun", tipo: "compmun", cargo: 0,
            titulo: "COMPARATIVO DE MUNICÍPIOS"});
  return pgs;
}
function paginaAtual(){
  var pgs = paginas();
  for(var i = 0; i < pgs.length; i++)
    if(pgs[i].id === estado.pagina) return pgs[i];
  return pgs[0];
}
function desenhaMenu(){
  var caixa = el("menu-paginas");
  caixa.innerHTML = "";
  paginas().forEach(function(p){
    var b = document.createElement("button");
    b.textContent = p.titulo;
    b.dataset.acao = "pagina";
    b.dataset.id = p.id;
    if(p.id === estado.pagina) b.className = "ativo";
    caixa.appendChild(b);
  });
}
function turnosDisponiveis(cargo){
  var ts = idx.turnos[estado.ano + "_" + estado.uf + "_" + cargo] || [1];
  if(!estado.mun) return ts;
  // com município escolhido, só os turnos que ELE teve — senão o
  // seletor oferece 2º turno em cidade que não teve
  return ts.filter(function(t){
    if(t === 1) return true;
    var lista = (idx.turnos_mun || {})[estado.ano + "_" + estado.uf +
      "_" + cargo + "_" + t] || [];
    return lista.indexOf(parseInt(estado.mun, 10)) >= 0;
  });
}
function ajustaTurnos(cargo){
  var ts = turnosDisponiveis(cargo);
  var caixa = el("c-turno-caixa");
  if(ts.length < 2){ caixa.classList.add("oculto"); return; }
  caixa.classList.remove("oculto");
  var s = el("c-turno");
  s.innerHTML = "";
  ts.forEach(function(t){
    var o = document.createElement("option");
    o.value = t; o.textContent = t + "º turno"; s.appendChild(o);
  });
  s.value = estado.turno;
}

/* ---------------- municípios ---------------- */
function desenhaMunicipios(filtro){
  var s = el("c-mun");
  s.innerHTML = "";
  var o0 = document.createElement("option");
  o0.value = ""; o0.textContent = "(todos os municípios)";
  s.appendChild(o0);
  var f = (filtro || "").toUpperCase(), sel = false;
  (idx.municipios[estado.uf] || []).forEach(function(m){
    if(f && m[1].toUpperCase().indexOf(f) < 0 &&
       String(m[0]) !== estado.mun) return;
    var o = document.createElement("option");
    o.value = m[0]; o.textContent = m[1]; s.appendChild(o);
    if(String(m[0]) === estado.mun) sel = true;
  });
  s.value = sel ? estado.mun : "";
}
function nomeMun(cd){
  var lista = idx.municipios[estado.uf] || [];
  for(var i = 0; i < lista.length; i++)
    if(String(lista[i][0]) === String(cd)) return lista[i][1];
  return "";
}

/* ---------------- abertura de página ---------------- */
function abrePagina(id){
  estado.pagina = id;
  estado.sel = {}; estado.selEst = null; estado.selFed = null;
  estado.turno = 1;
  estado.ultimo = null;   // senão o CSV sai com os dados da página anterior
  desenhaMenu();
  var p = paginaAtual();
  estado.pagina = p.id;
  atualizaSelecionados();
  el("pg-titulo").textContent = p.titulo + " — " + estado.ano + " " +
    estado.uf;
  var comCand = (p.tipo !== "ranking" && p.tipo !== "combinado");
  el("c-cand-caixa").classList.toggle("oculto", !comCand);
  el("c-cand-lista-caixa").classList.toggle("oculto", !comCand);
  el("c-cand-lista").innerHTML = comCand
    ? '<p style="padding:10px;color:#5B6478">Digite o nome ou o número ' +
      'do candidato acima para listar.</p>' : "";
  el("c-cand-busca").value = "";
  clearTimeout(buscaTimer);
  ++buscaSeq;   // invalida busca em voo da página anterior
  if(mapaLeaflet){ mapaLeaflet.remove(); mapaLeaflet = null; }
  el("c-mun-caixa").classList.toggle("oculto", p.tipo === "cidade");
  ajustaTurnos(p.cargo);
  aviso("");
  consultar();
}

function consultar(){
  var p = paginaAtual();
  var id = ++reqAtual;
  carregando();
  function guarda(fn){
    return function(dados){ if(id === reqAtual) fn(dados); };
  }
  function falha(e){
    if(id !== reqAtual) return;
    el("pg-tabela").innerHTML = "";
    el("pg-lateral").innerHTML = "";
    if(e && e.semDados){
      var onde = estado.mun ? nomeMun(estado.mun) : estado.uf;
      var qual = idx.cargos[p.cargo] || "deputados";
      aviso("Não há votação de " + qual + " em " + onde +
        " no " + estado.turno + "º turno de " + estado.ano + ".");
    } else {
      aviso("Falha ao carregar os dados: " + (e ? e.message : "?"));
    }
  }
  if(p.tipo === "ranking"){
    if(estado.mun){
      pega(arqSc(p.cargo, estado.mun)).then(guarda(function(sc){
        desenhaRanking(rankingDeSc(sc));
      })).catch(falha);
    } else {
      pega(arqRk()).then(guarda(desenhaRanking)).catch(falha);
    }
  } else if(p.tipo === "cidade"){
    if(!Object.keys(estado.sel).length){
      el("pg-tabela").innerHTML = "";
      aviso("Busque e marque um ou mais candidatos para ver os votos " +
        "por município.");
      return;
    }
    pega(arqMn(p.cargo)).then(guarda(desenhaCidade)).catch(falha);
  } else if(p.tipo === "secao"){
    if(!estado.mun){
      el("pg-tabela").innerHTML = "";
      aviso("Selecione o município para ver a votação por seção.");
      return;
    }
    pega(arqSc(p.cargo, estado.mun)).then(guarda(desenhaSecao))
      .catch(falha);
  } else if(p.tipo === "comparativo"){
    if(Object.keys(estado.sel).length < 2){
      el("pg-tabela").innerHTML = "";
      aviso("Marque de 2 a 6 candidatos para comparar. Sem município: " +
        "comparação por município; com município: por local e por seção.");
      return;
    }
    if(estado.mun){
      pega(arqSc(p.cargo, estado.mun)).then(guarda(function(sc){
        desenhaComparativoSecao(sc);
      })).catch(falha);
    } else {
      pega(arqMn(p.cargo)).then(guarda(desenhaComparativoMun))
        .catch(falha);
    }
  } else if(p.tipo === "mapa"){
    if(!estado.mun){
      el("pg-tabela").innerHTML = "";
      aviso("Selecione o município para ver o mapa de votos.");
      return;
    }
    pega(arqSc(p.cargo, estado.mun)).then(guarda(desenhaMapa))
      .catch(falha);
  } else if(p.tipo === "combinado"){
    var fontes = estado.mun
      ? [arqSc(7, estado.mun), arqSc(6, estado.mun)]
      : ["d/rk/" + estado.ano + "_" + estado.uf + "_7_1.json",
         "d/rk/" + estado.ano + "_" + estado.uf + "_6_1.json"];
    Promise.all(fontes.map(pega)).then(guarda(function(rs){
      desenhaCombinado(rs[0], rs[1], !!estado.mun);
    })).catch(falha);
  } else if(p.tipo === "evolucao"){
    if(!estado.mun){
      el("pg-tabela").innerHTML = "";
      el("pg-lateral").innerHTML = "";
      aviso("Selecione o município para comparar 2020 com 2024.");
    } else {
      pega("d/ev/" + estado.mun + "_" + p.cargo + ".json")
        .then(guarda(desenhaEvolucao)).catch(function(e){
          if(id !== reqAtual) return;
          el("pg-tabela").innerHTML = "";
          el("pg-lateral").innerHTML = "";
          aviso((e && e.semDados)
            ? "Sem comparação disponível para este município."
            : "Falha ao carregar: " + (e ? e.message : "?"));
        });
    }
  } else if(p.tipo === "custo"){
    pega("d/cv/" + estado.ano + "_" + estado.uf + "_" + p.cargo +
         ".json").then(guarda(desenhaCusto)).catch(function(e){
      if(id !== reqAtual) return;
      el("pg-tabela").innerHTML = "";
      el("pg-lateral").innerHTML = "";
      aviso((e && e.semDados)
        ? "Os dados de prestação de contas ainda não foram publicados."
        : "Falha ao carregar: " + (e ? e.message : "?"));
    });
  } else if(p.tipo === "perfilvoto"){
    var sqsPV = Object.keys(estado.sel).slice(0, 2);
    var municipal = (p.cargo === 11 || p.cargo === 13);
    if(municipal && !estado.mun){
      el("pg-tabela").innerHTML = "";
      el("pg-lateral").innerHTML = "";
      aviso("Selecione o município (o perfil de Prefeito/Vereador é " +
        "municipal).");
    } else if(!sqsPV.length){
      el("pg-tabela").innerHTML = "";
      el("pg-lateral").innerHTML = "";
      aviso("Busque e marque até 2 candidatos para ver o perfil " +
        "demográfico das seções onde eles pontuaram.");
    } else {
      var arqPV = municipal
        ? "d/pv/" + estado.mun + "_" + estado.ano + "_" + p.cargo +
          ".json"
        : "d/pv/" + estado.ano + "_" + estado.uf + "_" + p.cargo +
          ".json";
      pega(arqPV).then(guarda(function(f){
        desenhaPerfilVoto(f, sqsPV);
      })).catch(function(e){
        if(id !== reqAtual) return;
        el("pg-tabela").innerHTML = "";
        el("pg-lateral").innerHTML = "";
        aviso((e && e.semDados)
          ? "O perfil do eleitorado ainda não foi publicado para " +
            "este recorte."
          : "Falha ao carregar: " + (e ? e.message : "?"));
      });
    }
  } else if(p.tipo === "compmun"){
    pega("d/pan/" + estado.uf + ".json")
      .then(guarda(desenhaCompMun)).catch(falha);
  } else if(p.tipo === "panorama"){
    if(!estado.mun){
      el("pg-tabela").innerHTML = "";
      el("pg-lateral").innerHTML = "";
      aviso("Selecione o município para ver o panorama.");
      return;
    }
    pega("d/pan/" + estado.uf + ".json")
      .then(guarda(desenhaPanorama)).catch(falha);
  } else if(p.tipo === "casadinha"){
    if(!(estado.selEst && estado.selFed)){
      el("pg-tabela").innerHTML = "";
      aviso("Marque UM deputado estadual e UM federal (a busca traz os " +
        "dois cargos).");
      return;
    }
    if(estado.mun){
      Promise.all([pega(arqSc(7, estado.mun)), pega(arqSc(6, estado.mun))])
        .then(guarda(function(rs){ desenhaCasadinhaSecao(rs[0], rs[1]); }))
        .catch(falha);
    } else {
      Promise.all([pega(arqMn(7)), pega(arqMn(6))])
        .then(guarda(function(rs){ desenhaCasadinhaMun(rs[0], rs[1]); }))
        .catch(falha);
    }
  }
}

/* ---------------- transformações ---------------- */
function paresParaMapa(v){   // [i,votos,i,votos,...] -> {i: votos}
  var m = {};
  for(var k = 0; k < v.length; k += 2) m[v[k]] = v[k+1];
  return m;
}
function somaPares(v){
  var s = 0;
  for(var k = 1; k < v.length; k += 2) s += v[k];
  return s;
}
function rankingDeSc(sc){
  var linhas = [], total = 0;
  Object.keys(sc.c).forEach(function(sq){
    var c = sc.c[sq];
    var s = somaPares(c.v);
    total += s;
    linhas.push([c.n, c.p, c.si, s, (sq.charAt(0) === "e" ? 0 : sq), ""]);
  });
  linhas.sort(function(a, b){ return b[3] - a[3]; });
  return {total: total, l: linhas, mun: null};
}

/* ---------------- desenhos ---------------- */
function desenhaRanking(r){
  estado.ultimo = {tipo: "ranking", dados: r};
  var linhas = r.l.slice(0, 300);
  aviso(r.l.length > 300 ? "Exibindo os 300 votáveis mais votados de " +
    num(r.l.length) + "." : "");
  var max = linhas.length ? linhas[0][3] : 0;
  var h = ['<table><thead><tr><th>Votável</th><th>Partido</th>',
    "<th>Situação</th>", '<th class="num">Votos</th>',
    '<th class="c-bar"></th><th class="num">% apurados</th>',
    "</tr></thead><tbody>"];
  linhas.forEach(function(ln){
    h.push("<tr><td>" + (ln[4]
      ? '<span class="minimapa-alvo" data-sq="' + ln[4] + '">' +
        esc(ln[0]) + "</span>"
      : esc(ln[0])) +
      (ln[5] ? ' <span style="color:#8A93A8">· ' + esc(ln[5]) +
       "</span>" : "") + "</td>");
    h.push("<td>" + esc(ln[1]) + "</td>");
    h.push("<td>" + situHtml(ln[2]) + "</td>");
    h.push('<td class="num"><b>' + num(ln[3]) + "</b></td>");
    h.push('<td class="c-bar">' + barra(ln[3], max) + "</td>");
    h.push('<td class="num">' + pct(ln[3], r.total) + "</td></tr>");
  });
  h.push("</tbody></table>");
  el("pg-tabela").innerHTML = h.join("");
  var lat = [kpi(r.total, estado.mun
    ? "votos apurados no município" : "soma de votos apurados")];
  if(r.mun && r.mun.length){
    lat.push('<div class="cartao rolagem"><table><thead><tr>');
    lat.push('<th>Município</th><th class="num">Votos apurados</th>');
    lat.push("</tr></thead><tbody>");
    r.mun.forEach(function(m){
      lat.push("<tr><td>" + esc(m[0]) + '</td><td class="num">' +
        num(m[1]) + "</td></tr>");
    });
    lat.push("</tbody></table></div>");
  }
  el("pg-lateral").innerHTML = lat.join("");
}

function desenhaCidade(mn){
  var sqs = Object.keys(estado.sel);
  var acum = {}, urb = {}, rur = {};
  var total = 0, totalU = 0, totalR = 0;
  function soma(destino, pares, conta){
    if(!pares) return 0;
    var s = 0;
    for(var k = 0; k < pares.length; k += 2){
      destino[pares[k]] = (destino[pares[k]] || 0) + pares[k+1];
      s += pares[k+1];
    }
    return conta ? s : 0;
  }
  sqs.forEach(function(sq){
    var c = mn.c[sq];
    if(!c) return;
    total += soma(acum, c.v, true);
    totalU += soma(urb, c.u, true);
    totalR += soma(rur, c.r, true);
  });
  var linhas = Object.keys(acum).map(function(i){
    return [mn.m[i][1], acum[i], urb[i] || 0, rur[i] || 0]; });
  linhas.sort(function(a, b){ return b[1] - a[1]; });
  estado.ultimo = {tipo: "cidade", linhas: linhas, total: total};
  aviso("");
  var max = linhas.length ? linhas[0][1] : 0;
  var h = ['<table><thead><tr><th>Município</th>',
    '<th class="num">Votos</th><th class="c-bar"></th>',
    '<th class="num">% do selecionado</th>',
    '<th class="num">Urbana</th><th class="num">Rural</th>',
    '<th class="num">% rural</th></tr></thead><tbody>'];
  linhas.forEach(function(ln){
    h.push("<tr><td>" + esc(ln[0]) + '</td><td class="num"><b>' +
      num(ln[1]) + '</b></td><td class="c-bar">' + barra(ln[1], max) +
      '</td><td class="num">' + pct(ln[1], total) + "</td>" +
      '<td class="num">' + num(ln[2]) + "</td>" +
      '<td class="num">' + num(ln[3]) + "</td>" +
      '<td class="num">' + pct(ln[3], ln[1]) + "</td></tr>");
  });
  h.push("</tbody></table>");
  h.push('<div style="margin-top:10px;font-size:12.5px;' +
    'color:var(--tinta2)">Urbana e rural saem do SUFIXO DO ENDEREÇO ' +
    "do local de votação, como o TSE publica. Local sem essa " +
    "indicação não entra em nenhuma das duas colunas — por isso a " +
    "soma delas pode ficar abaixo do total.</div>");
  el("pg-tabela").innerHTML = h.join("");
  var lat = [kpi(total, "votos dos candidatos selecionados"),
    kpi(totalU, "votos em zona urbana (" + pct(totalU, total) + ")"),
    kpi(totalR, "votos em zona rural (" + pct(totalR, total) + ")")];
  var semInd = total - totalU - totalR;
  if(semInd > 0){
    lat.push(kpi(semInd, "sem indicação de área no endereço"));
  }
  el("pg-lateral").innerHTML = lat.join("");
}

function resumosDeSecao(sc, mapa, total){
  var porLocal = {}, porEnde = {}, porArea = {};
  Object.keys(mapa).forEach(function(si){
    var s = sc.S[si], li = s[2], loc = sc.L[li];
    var v = mapa[si];
    var gl = porLocal[li] || (porLocal[li] =
      {nome: loc[0], ende: loc[1], secoes: 0, votos: 0});
    gl.secoes += 1; gl.votos += v;
    var ge = porEnde[loc[1]] || (porEnde[loc[1]] =
      {nome: loc[1], locais: {}, secoes: 0, votos: 0});
    ge.locais[li] = 1; ge.secoes += 1; ge.votos += v;
    var up = (loc[1] || "").toUpperCase();
    var area = up.indexOf("ZONA RURAL") >= 0 ? "ZONA RURAL"
      : (up.indexOf("ZONA URBANA") >= 0 ? "ZONA URBANA" : "SEM INDICAÇÃO");
    var ga = porArea[area] || (porArea[area] =
      {nome: area, locais: {}, secoes: 0, votos: 0});
    ga.locais[li] = 1; ga.secoes += 1; ga.votos += v;
  });
  function lista(o){
    return Object.keys(o).map(function(k){
      var g = o[k];
      return {nome: g.nome, secoes: g.secoes, votos: g.votos,
              locais: g.locais ? Object.keys(g.locais).length : 1};
    }).sort(function(a, b){ return b.votos - a.votos; });
  }
  return {local: lista(porLocal), endereco: lista(porEnde),
          area: lista(porArea), total: total};
}

function cartaoResumo(titulo, linhas, rotuloCol, total){
  if(!linhas || !linhas.length) return "";
  var max = linhas[0].votos;
  var h = ['<div class="cartao rolagem">'];
  h.push('<div style="font-weight:700;margin-bottom:6px">' +
    esc(titulo) + "</div>");
  h.push("<table><thead><tr><th>" + esc(rotuloCol) + "</th>");
  h.push('<th class="num">Seções</th><th class="num">Votos</th>');
  h.push('<th class="c-bar"></th><th class="num">%</th>');
  h.push("</tr></thead><tbody>");
  linhas.forEach(function(g){
    h.push("<tr><td>" + esc(g.nome) +
      (g.locais > 1 ? ' <span style="color:#8A93A8;font-size:12px">(' +
       num(g.locais) + " locais)</span>" : "") + "</td>");
    h.push('<td class="num">' + num(g.secoes) + "</td>");
    h.push('<td class="num"><b>' + num(g.votos) + "</b></td>");
    h.push('<td class="c-bar">' + barra(g.votos, max) + "</td>");
    h.push('<td class="num">' + pct(g.votos, total) + "</td></tr>");
  });
  h.push("</tbody></table></div>");
  return h.join("");
}

function desenhaSecao(sc){
  var sqs = Object.keys(estado.sel);
  var mapa = {}, total = 0;
  var fonte = sqs.length ? sqs : Object.keys(sc.c);
  fonte.forEach(function(sq){
    var c = sc.c[sq];
    if(!c) return;
    if(!sqs.length && sq.charAt(0) === "e") return;  // só candidatos
    for(var k = 0; k < c.v.length; k += 2){
      mapa[c.v[k]] = (mapa[c.v[k]] || 0) + c.v[k+1];
      total += c.v[k+1];
    }
  });
  var linhas = Object.keys(mapa).map(function(si){
    var s = sc.S[si];
    return {zona: s[0], secao: s[1], local: sc.L[s[2]][0],
            ende: sc.L[s[2]][1], votos: mapa[si]};
  }).sort(function(a, b){ return b.votos - a.votos; });
  var res = resumosDeSecao(sc, mapa, total);
  estado.ultimo = {tipo: "secao", linhas: linhas, total: total,
                   resumos: res};
  aviso("");
  var max = linhas.length ? linhas[0].votos : 0;
  var h = ['<table><thead><tr><th class="num">Zona</th>',
    '<th class="num">Seção</th><th>Local de votação</th><th>Endereço</th>',
    '<th class="num">Votos</th><th class="c-bar"></th>',
    '<th class="num">% do total</th></tr></thead><tbody>'];
  linhas.forEach(function(ln){
    h.push('<tr><td class="num">' + num(ln.zona) + "</td>");
    h.push('<td class="num">' + num(ln.secao) + "</td>");
    h.push("<td>" + esc(ln.local) + "</td>");
    h.push('<td style="color:#8A93A8">' + esc(ln.ende) + "</td>");
    h.push('<td class="num"><b>' + num(ln.votos) + "</b></td>");
    h.push('<td class="c-bar">' + barra(ln.votos, max) + "</td>");
    h.push('<td class="num">' + pct(ln.votos, total) + "</td></tr>");
  });
  h.push("</tbody></table>");
  el("pg-tabela").innerHTML = h.join("");
  var lat = [kpi(total, sqs.length
    ? "votos dos selecionados no município"
    : "votos nominais no município")];
  lat.push(cartaoResumo("Resumo urbana × rural", res.area, "Área", total));
  lat.push(cartaoResumo("Resumo por local de votação", res.local,
    "Local", total));
  lat.push(cartaoResumo("Resumo por endereço", res.endereco,
    "Endereço", total));
  el("pg-lateral").innerHTML = lat.join("");
}

function colunasSel(fonte){
  return Object.keys(estado.sel).map(function(sq){
    var c = fonte.c[sq];
    return {sq: sq, nome: c ? c.n : sq, partido: c ? c.p : "",
            total: c ? somaPares(c.v) : 0};
  }).sort(function(a, b){ return b.total - a.total; });
}
function tabelaComparativa(colunas, linhas, cabecalhos, celulas){
  var h = ["<table><thead><tr>"];
  cabecalhos.forEach(function(c){ h.push(c); });
  colunas.forEach(function(c){
    h.push('<th class="num">' + esc(c.nome) + "<br>" +
      '<span style="font-weight:400">' + esc(c.partido) + "</span></th>");
  });
  h.push("</tr></thead><tbody>");
  linhas.forEach(function(ln){
    h.push("<tr>");
    celulas(ln).forEach(function(c){ h.push(c); });
    var vals = colunas.map(function(c){ return ln.v[c.sq] || 0; });
    var maior = Math.max.apply(null, vals);
    vals.forEach(function(v){
      h.push('<td class="num"' + ((v === maior && maior > 0) ?
        ' style="background:var(--acento-suave);font-weight:700"' : "") +
        ">" + num(v) + "</td>");
    });
    h.push("</tr>");
  });
  h.push("</tbody></table>");
  return h.join("");
}
function cartoesColunas(colunas){
  var max = colunas.length ? colunas[0].total : 0;
  return colunas.map(function(c){
    return '<div class="cartao"><div style="font-weight:700">' +
      esc(c.nome) + ' <span style="color:#8A93A8">' + esc(c.partido) +
      '</span></div><div class="kpi" style="font-size:26px">' +
      num(c.total) + "</div>" + barra(c.total, max) + "</div>";
  }).join("");
}

function desenhaComparativoMun(mn){
  var colunas = colunasSel(mn);
  var grupos = {};
  Object.keys(estado.sel).forEach(function(sq){
    var c = mn.c[sq];
    if(!c) return;
    for(var k = 0; k < c.v.length; k += 2){
      var g = grupos[c.v[k]] || (grupos[c.v[k]] =
        {nome: mn.m[c.v[k]][1], v: {}, soma: 0});
      g.v[sq] = (g.v[sq] || 0) + c.v[k+1];
      g.soma += c.v[k+1];
    }
  });
  var linhas = Object.keys(grupos).map(function(k){ return grupos[k]; })
    .sort(function(a, b){ return b.soma - a.soma; });
  estado.ultimo = {tipo: "comparativo", base: "municipio",
                   colunas: colunas, linhas: linhas};
  aviso("");
  el("pg-tabela").innerHTML = tabelaComparativa(colunas, linhas,
    ["<th>Município</th>"],
    function(ln){ return ["<td>" + esc(ln.nome) + "</td>"]; });
  el("pg-lateral").innerHTML = cartoesColunas(colunas);
}

function desenhaComparativoSecao(sc){
  var colunas = colunasSel(sc);
  var porSecao = {}, porLocal = {};
  Object.keys(estado.sel).forEach(function(sq){
    var c = sc.c[sq];
    if(!c) return;
    for(var k = 0; k < c.v.length; k += 2){
      var si = c.v[k], votos = c.v[k+1], s = sc.S[si];
      var g = porSecao[si] || (porSecao[si] =
        {zona: s[0], secao: s[1], local: sc.L[s[2]][0], v: {}, soma: 0});
      g.v[sq] = (g.v[sq] || 0) + votos; g.soma += votos;
      var gl = porLocal[s[2]] || (porLocal[s[2]] =
        {nome: sc.L[s[2]][0], ende: sc.L[s[2]][1], v: {}, soma: 0});
      gl.v[sq] = (gl.v[sq] || 0) + votos; gl.soma += votos;
    }
  });
  function ordena(o){
    return Object.keys(o).map(function(k){ return o[k]; })
      .sort(function(a, b){ return b.soma - a.soma; });
  }
  var linhas = ordena(porSecao), linhasLocal = ordena(porLocal);
  estado.ultimo = {tipo: "comparativo", base: "secao", colunas: colunas,
                   linhas: linhas, linhasLocal: linhasLocal};
  aviso("");
  var h = [];
  h.push('<div style="font-weight:700;margin-bottom:6px">' +
    "Comparativo por local de votação</div>");
  h.push(tabelaComparativa(colunas, linhasLocal,
    ["<th>Local de votação</th>"], function(ln){
      return ["<td>" + esc(ln.nome) +
        '<br><span style="color:#8A93A8;font-size:12px">' +
        esc(ln.ende) + "</span></td>"]; }));
  h.push('<div style="font-weight:700;margin:14px 0 6px">' +
    "Comparativo por seção</div>");
  h.push(tabelaComparativa(colunas, linhas,
    ['<th class="num">Zona</th>', '<th class="num">Seção</th>',
     "<th>Local</th>"], function(ln){
      return ['<td class="num">' + num(ln.zona) + "</td>",
              '<td class="num">' + num(ln.secao) + "</td>",
              "<td>" + esc(ln.local) + "</td>"]; }));
  el("pg-tabela").innerHTML = h.join("");
  el("pg-lateral").innerHTML = cartoesColunas(colunas);
}


function agregaPorLocal(sc){
  // por local: votos dos selecionados (ou nominais totais) + nominais
  // do local + votos por candidato selecionado (p/ modo ranking)
  var sqs = Object.keys(estado.sel);
  var locs = {};
  Object.keys(sc.c).forEach(function(sq){
    if(sq.charAt(0) === "e") return;
    var doSel = sqs.length ? !!estado.sel[sq] : true;
    var c = sc.c[sq];
    for(var k = 0; k < c.v.length; k += 2){
      var li = sc.S[c.v[k]][2], v = c.v[k+1];
      var g = locs[li] || (locs[li] = {li: li, nominais: 0, sel: 0,
                                       porSq: {}});
      g.nominais += v;
      if(doSel){
        g.sel += v;
        if(sqs.length) g.porSq[sq] = (g.porSq[sq] || 0) + v;
      }
    }
  });
  // aptos (perfil do eleitorado) e apurados por local — entradas S
  // ganharam [3]=aptos e [4]=apurados quando os complementos existem
  sc.S.forEach(function(s){
    if(s.length < 5) return;
    var g = locs[s[2]];
    if(!g) return;
    g.aptos = (g.aptos || 0) + (s[3] || 0);
    g.apurados = (g.apurados || 0) + (s[4] || 0);
  });
  return Object.keys(locs).map(function(k){ return locs[k]; });
}

function desenhaMapa(sc){
  var sqs = Object.keys(estado.sel);
  var locais = agregaPorLocal(sc);
  var total = 0;
  locais.forEach(function(g){ total += g.sel; });
  var comCoord = [], semCoord = [];
  locais.forEach(function(g){
    var L2 = sc.L[g.li];
    g.nome = L2[0]; g.ende = L2[1]; g.bairro = L2[2] || "";
    g.lat = L2[3]; g.lon = L2[4]; g.aprox = L2[5] || 0;
    (g.lat !== null && g.lat !== undefined &&
     g.lon !== null && g.lon !== undefined ? comCoord : semCoord).push(g);
  });
  comCoord.sort(function(a, b){ return b.sel - a.sel; });
  semCoord.sort(function(a, b){ return b.sel - a.sel; });
  estado.ultimo = {tipo: "mapa", linhas: locais.slice()
    .sort(function(a, b){ return b.sel - a.sel; }), total: total};
  aviso(typeof L === "undefined"
    ? "O mapa precisa de conexão com a internet para carregar." : "");

  var temAbst = locais.some(function(g){ return (g.aptos || 0) > 0; });
  if(modoMapa === "abstencao" && !temAbst) modoMapa = "votos";
  var modos = [["votos", "Votos"], ["percentual", "Percentual"],
   ["ranking", "Ranking"], ["calor", "Mapa de Calor"]];
  if(temAbst) modos.push(["abstencao", "Abstenção"]);
  var h = ['<div class="modo-botoes nao-imprime">'];
  modos.forEach(function(m){
      h.push('<button data-acao="modo-mapa" data-modo="' + m[0] + '"' +
        (modoMapa === m[0] ? ' class="ativo"' : "") + ">" + m[1] +
        "</button>");
    });
  if(comCoord.length){
    h.push('<button data-acao="mapa-tela" style="margin-left:auto">' +
      "Tela inteira</button>");
  }
  h.push("</div>");
  if(comCoord.length){
    h.push('<div id="mapa-caixa" class="mapa-caixa"></div>');
    var nAprox = comCoord.filter(function(g){ return g.aprox; }).length;
    if(nAprox){
      h.push('<div style="margin-top:8px;font-size:12.5px;' +
        'color:var(--tinta2)"><b>' + num(nAprox) + " " +
        (nAprox === 1 ? "local está" : "locais estão") +
        " em posição APROXIMADA</b> (borda tracejada): o TSE não " +
        "publicou a coordenada e a posição foi estimada pelo nome do " +
        "bairro/povoado ou pelo mesmo local em outro pleito.</div>");
    }
    if(semCoord.length){
      h.push('<div style="margin-top:10px;font-size:12.5px;' +
        'color:var(--tinta2)"><b>' + num(semCoord.length) +
        " locais sem coordenada no TSE</b> (geralmente rurais) — " +
        semCoord.slice(0, 8).map(function(g){
          return esc(g.nome) + " (" + num(g.sel) + ")"; }).join("; ") +
        (semCoord.length > 8 ? "…" : "") + "</div>");
    }
  } else {
    // município que o TSE nunca geocodificou (ex.: Camaçari):
    // sem mapa possível — tabela completa por local no lugar
    h.push('<div class="aviso" style="margin:0 0 10px">O TSE não ' +
      'publicou coordenadas para os locais de votação deste ' +
      'município — o mapa não pode ser desenhado. Abaixo, a votação ' +
      'por local; o resumo por bairro segue ao lado.</div>');
    h.push('<table><thead><tr><th>Local de votação</th>' +
      '<th>Bairro</th><th class="num">Votos</th>' +
      '<th class="c-bar"></th><th class="num">%</th>' +
      '</tr></thead><tbody>');
    var maxL2 = semCoord.length ? semCoord[0].sel : 0;
    semCoord.forEach(function(g){
      h.push("<tr><td>" + esc(g.nome) + "</td><td>" + esc(g.bairro) +
        '</td><td class="num"><b>' + num(g.sel) + "</b></td>" +
        '<td class="c-bar">' + barra(g.sel, maxL2) + "</td>" +
        '<td class="num">' + pct(g.sel, total) + "</td></tr>");
    });
    h.push("</tbody></table>");
  }
  el("pg-tabela").innerHTML = h.join("");

  var lat;
  if(modoMapa === "abstencao" && temAbst){
    var aptosM = 0, apurM = 0;
    locais.forEach(function(g){
      aptosM += g.aptos || 0; apurM += g.apurados || 0;
    });
    lat = [kpi(aptosM, "eleitores aptos no município"),
           kpi(apurM, "comparecimento (" + pct(apurM, aptosM) + ")"),
           kpi(aptosM - apurM,
               "abstenções (" + pct(aptosM - apurM, aptosM) + ")")];
  } else {
    lat = [kpi(total, sqs.length
      ? "votos dos selecionados no município"
      : "votos nominais no município")];
  }
  if(modoMapa === "ranking" && sqs.length){
    var leg = ['<div class="cartao"><div style="font-weight:700;' +
      'margin-bottom:6px">Quem lidera em cada local</div>'];
    sqs.forEach(function(sq, i){
      var c = sc.c[sq];
      leg.push('<div style="margin:3px 0"><span style="display:' +
        'inline-block;width:12px;height:12px;border-radius:50%;' +
        'background:' + CORES_RANKING[i % CORES_RANKING.length] +
        ';margin-right:8px"></span>' + esc(c ? c.n : sq) + "</div>");
    });
    leg.push("</div>");
    lat.push(leg.join(""));
  }
  // resumo por bairro
  var bairros = {};
  locais.forEach(function(g){
    var b = g.bairro || "(sem bairro no TSE)";
    var gb = bairros[b] || (bairros[b] = {nome: b, votos: 0, locais: 0});
    gb.votos += g.sel; gb.locais += 1;
  });
  var listaB = Object.keys(bairros).map(function(k){ return bairros[k]; })
    .sort(function(a, b){ return b.votos - a.votos; });
  if(listaB.length > 1){
    var hb = ['<div class="cartao rolagem"><div style="font-weight:700;' +
      'margin-bottom:6px">Resumo por bairro</div><table><thead><tr>' +
      '<th>Bairro</th><th class="num">Locais</th>' +
      '<th class="num">Votos</th><th class="c-bar"></th>' +
      '<th class="num">%</th></tr></thead><tbody>'];
    var maxB = listaB[0].votos;
    listaB.forEach(function(g){
      hb.push("<tr><td>" + esc(g.nome) + '</td><td class="num">' +
        num(g.locais) + '</td><td class="num"><b>' + num(g.votos) +
        '</b></td><td class="c-bar">' + barra(g.votos, maxB) +
        '</td><td class="num">' + pct(g.votos, total) + "</td></tr>");
    });
    hb.push("</tbody></table></div>");
    lat.push(hb.join(""));
  }
  el("pg-lateral").innerHTML = lat.join("");

  if(mapaLeaflet){ mapaLeaflet.remove(); mapaLeaflet = null; }
  if(typeof L === "undefined" || !comCoord.length) return;
  var mapa = L.map("mapa-caixa");
  mapaLeaflet = mapa;
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {maxZoom: 19, attribution: "&copy; OpenStreetMap"}).addTo(mapa);
  var limites = [];
  var maxSel = comCoord[0].sel || 1;
  var maxAptos = 1;
  comCoord.forEach(function(g){
    if((g.aptos || 0) > maxAptos) maxAptos = g.aptos;
  });
  comCoord.forEach(function(g){
    limites.push([g.lat, g.lon]);
    var cor = "#6366F1", raio, opac = 0.75, borda = "#FFFFFF";
    if(modoMapa === "abstencao"){
      var taxa = g.aptos ? (g.aptos - g.apurados) / g.aptos : 0;
      raio = 5 + 20 * Math.sqrt((g.aptos || 0) / maxAptos);
      cor = "#EF4444";
      opac = Math.min(0.85, 0.15 + taxa * 2.2);
    } else if(modoMapa === "ranking" && sqs.length){
      var lider = null, mv = -1;
      sqs.forEach(function(sq, i){
        var v = g.porSq[sq] || 0;
        if(v > mv){ mv = v; lider = i; }
      });
      cor = mv > 0 ? CORES_RANKING[lider % CORES_RANKING.length]
                   : "#C3C8D4";
      raio = 6 + 16 * Math.sqrt(g.sel / maxSel);
    } else if(modoMapa === "percentual"){
      var p2 = g.nominais ? g.sel / g.nominais : 0;
      raio = 14;
      opac = 0.25 + 0.65 * p2;
    } else if(modoMapa === "calor"){
      raio = 14 + 40 * Math.sqrt(g.sel / maxSel);
      opac = 0.35; borda = "transparent";
    } else {
      raio = 5 + 22 * Math.sqrt(g.sel / maxSel);
    }
    var marca = L.circleMarker([g.lat, g.lon], {radius: raio,
      color: g.aprox ? "#8A93A8" : borda,
      weight: g.aprox ? 2 : 1.5, dashArray: g.aprox ? "4 3" : null,
      fillColor: cor, fillOpacity: opac});
    var linhasPop = ["<b>" + esc(g.nome) + "</b>" +
      (g.aprox ? ' <i style="color:#8A93A8">(posição aproximada)</i>'
               : ""),
      esc(g.bairro || ""), esc(g.ende || ""),
      "Votos: <b>" + num(g.sel) + "</b>" +
      (g.nominais ? " (" + pct(g.sel, g.nominais) +
        " dos nominais do local)" : ""),
      total ? pct(g.sel, total) + " do total no município" : ""];
    if(modoMapa === "ranking" && sqs.length){
      sqs.forEach(function(sq){
        var c = sc.c[sq];
        linhasPop.push(esc(c ? c.n : sq) + ": " + num(g.porSq[sq] || 0));
      });
    }
    if(modoMapa === "abstencao" && g.aptos){
      linhasPop.push("Aptos: <b>" + num(g.aptos) + "</b>");
      linhasPop.push("Comparecimento: " + num(g.apurados) + " (" +
        pct(g.apurados, g.aptos) + ")");
      linhasPop.push("Abstenção: <b>" +
        pct(g.aptos - g.apurados, g.aptos) + "</b>");
    }
    var conteudo = linhasPop.filter(function(x){ return x; })
      .join("<br>");
    // hover mostra tudo sem clique; o clique (popup) continua valendo
    // para telas de toque, onde hover não existe
    marca.bindTooltip(conteudo, {sticky: true, direction: "top",
                                 opacity: 0.96});
    marca.bindPopup(conteudo);
    marca.addTo(mapa);
  });
  mapa.fitBounds(limites, {padding: [30, 30]});
}

/* ---------------- evolução 2020 → 2024 ---------------- */
function seta(d){
  if(d > 0) return '<span style="color:#10B981">▲ +' + num(d) +
    "</span>";
  if(d < 0) return '<span style="color:#EF4444">▼ ' + num(d) +
    "</span>";
  return '<span style="color:#8A93A8">=</span>';
}
function desenhaEvolucao(f){
  ajustaTurnos({turnos: [1]});
  var sq = Object.keys(estado.sel)[0];
  var cand = sq ? f.c[sq] : null;
  if(sq && !cand){
    el("pg-tabela").innerHTML = "";
    el("pg-lateral").innerHTML = "";
    aviso("O candidato marcado não tem candidatura nos dois pleitos " +
      "neste município (pareamento por título de eleitor).");
    return;
  }
  aviso("");
  var pares = cand ? cand.v : null;
  var porLi = {};
  if(pares){
    for(var k = 0; k < pares.length; k += 3){
      porLi[pares[k]] = [pares[k+1], pares[k+2]];
    }
  } else {
    f.t.forEach(function(x){ porLi[x[0]] = [x[1], x[2]]; });
  }
  var linhas = Object.keys(porLi).map(function(li){
    var L2 = f.L[li] || ["(local não cadastrado)", "", ""];
    return {nome: L2[0], bairro: L2[2] || "",
            a: porLi[li][0], b: porLi[li][1],
            dif: porLi[li][1] - porLi[li][0]};
  });
  linhas.sort(function(x, y){ return Math.abs(y.dif) - Math.abs(x.dif); });
  var totalA = 0, totalB = 0, pareados = 0;
  linhas.forEach(function(l){
    totalA += l.a; totalB += l.b;
    if(l.a && l.b) pareados += 1;
  });
  estado.ultimo = {tipo: "evolucao", linhas: linhas, total: totalB};
  var h = ['<table><thead><tr><th>Local de votação</th><th>Bairro</th>',
    '<th class="num">2020</th><th class="num">2024</th>',
    '<th class="num">Diferença</th><th class="num">Variação</th>',
    "</tr></thead><tbody>"];
  linhas.forEach(function(ln){
    h.push("<tr><td>" + esc(ln.nome) +
      (!ln.a ? ' <span class="situ situ-outro">NOVO</span>' : "") +
      (!ln.b ? ' <span class="situ situ-outro">SEM VOTOS EM 2024' +
        "</span>" : "") + "</td>");
    h.push("<td>" + esc(ln.bairro) + "</td>");
    h.push('<td class="num">' + num(ln.a) + "</td>");
    h.push('<td class="num"><b>' + num(ln.b) + "</b></td>");
    h.push('<td class="num">' + seta(ln.dif) + "</td>");
    h.push('<td class="num">' + (ln.a ? pct(ln.dif, ln.a) : "—") +
      "</td></tr>");
  });
  h.push("</tbody></table>");
  h.push('<div style="margin-top:10px;font-size:12.5px;' +
    'color:var(--tinta2)">Locais pareados pelo número do local dentro ' +
    "da zona — o TSE renomeia escolas, mas mantém o número. " +
    (cand ? "A mesma pessoa nos dois pleitos é identificada pelo " +
      "TÍTULO DE ELEITOR (o CPF de 2024 não é divulgado e o código " +
      "da candidatura muda a cada eleição). "
      : "Sem candidato marcado, a comparação é dos VOTOS NOMINAIS do " +
        "cargo. ") +
    "Locais marcados como NOVO não tinham voto em 2020.</div>");
  el("pg-tabela").innerHTML = h.join("");
  var lat = [];
  if(cand){
    lat.push('<div class="cartao"><div style="font-weight:700;' +
      'margin-bottom:6px">Mesma pessoa nos dois pleitos</div>' +
      '<div style="margin:3px 0">2020: ' +
      esc(cand.n20 + " (" + (cand.p20 || "") + ")") + "</div>" +
      '<div style="margin:3px 0">2024: ' +
      esc(cand.n + " (" + (cand.p || "") + ")") + "</div></div>");
  }
  var dif = totalB - totalA;
  lat.push(kpi(totalA, "votos em 2020"), kpi(totalB, "votos em 2024"));
  lat.push('<div class="cartao"><div class="kpi">' +
    (dif >= 0 ? "+" : "") + num(dif) + '</div><div class="kpi-rotulo">' +
    "diferença" + (totalA ? " (" + pct(dif, totalA) + ")" : "") +
    "</div></div>");
  lat.push(kpi(pareados, "locais presentes nos dois pleitos"));
  el("pg-lateral").innerHTML = lat.join("");
}

/* ---------------- custo do voto ---------------- */
function desenhaCusto(f){
  ajustaTurnos({turnos: [1]});
  aviso("");
  var municipal = (paginaAtual().cargo === 11 ||
                   paginaAtual().cargo === 13);
  var linhas = f.l;
  if(municipal && estado.mun){
    linhas = linhas.filter(function(ln){
      return String(ln[2]) === String(estado.mun);
    });
  }
  var ordens = {
    votos: function(a, b){ return b[6] - a[6]; },
    custo_menor: function(a, b){
      return (a[10] === null) - (b[10] === null) ||
             (a[10] || 0) - (b[10] || 0); },
    custo_maior: function(a, b){
      return (a[10] === null) - (b[10] === null) ||
             (b[10] || 0) - (a[10] || 0); },
    despesa: function(a, b){
      return (b[9] || 0) - (a[9] || 0); }
  };
  linhas = linhas.slice().sort(ordens[ordemCusto] || ordens.votos);
  var totalD = 0, semC = 0;
  linhas.forEach(function(ln){
    totalD += ln[9] || 0;
    if(ln[11] === "sem contas") semC += 1;
  });
  var corte = linhas.length > 300;
  if(corte){
    aviso("Exibindo 300 de " + num(linhas.length) +
      " candidaturas do recorte.");
  }
  var mostra = linhas.slice(0, 300);
  var h = ['<div class="modo-botoes nao-imprime">'];
  [["votos", "Mais votos"], ["custo_menor", "Menor R$/voto"],
   ["custo_maior", "Maior R$/voto"], ["despesa", "Maior despesa"]]
    .forEach(function(m2){
      h.push('<button data-acao="ordem-custo" data-ordem="' + m2[0] +
        '"' + (ordemCusto === m2[0] ? ' class="ativo"' : "") + ">" +
        m2[1] + "</button>");
    });
  h.push("</div>");
  h.push("<table><thead><tr><th>Candidato</th><th>Partido</th>",
    "<th>Município</th><th>Situação</th>",
    '<th class="num">Votos</th><th class="num">Despesa</th>',
    '<th class="num">R$/voto</th><th>Contas</th></tr></thead><tbody>');
  mostra.forEach(function(ln){
    h.push("<tr><td>" + esc(ln[0]) + "</td>");
    h.push("<td>" + esc(ln[1]) + "</td>");
    h.push("<td>" + esc(ln[3] || "(estadual)") + "</td>");
    h.push("<td>" + situHtml(ln[4]) + "</td>");
    h.push('<td class="num">' + num(ln[6]) +
      (ln[7] ? " <small>(1º+2º t)</small>" : "") + "</td>");
    h.push('<td class="num">' + dinheiro(ln[9]) + "</td>");
    h.push('<td class="num"><b>' + dinheiro(ln[10]) + "</b></td>");
    h.push("<td>" + (ln[11] === "sem contas"
      ? '<span class="situ situ-outro">SEM CONTAS</span>'
      : "com contas") + "</td></tr>");
  });
  h.push("</tbody></table>");
  h.push('<div style="margin-top:10px;font-size:12.5px;' +
    'color:var(--tinta2)">Despesas declaradas ao TSE (prestação de ' +
    "contas da campanha inteira) divididas pelos votos de 1º + 2º " +
    'turno. "SEM CONTAS" inclui candidaturas anuladas com votos ' +
    "apurados — não é custo zero.</div>");
  el("pg-tabela").innerHTML = h.join("");
  el("pg-lateral").innerHTML =
    '<div class="cartao"><div class="kpi">' + dinheiro(totalD) +
    '</div><div class="kpi-rotulo">despesa declarada no recorte' +
    "</div></div>" +
    kpi(linhas.length, "candidaturas no recorte") +
    kpi(semC, "sem prestação de contas");
}

/* ---------------- perfil do voto ---------------- */
function desenhaPerfilVoto(f, sqsPV){
  ajustaTurnos({turnos: [1]});
  var sqs = sqsPV.filter(function(sq){ return f.c[sq]; });
  if(!sqs.length){
    el("pg-tabela").innerHTML = "";
    el("pg-lateral").innerHTML = "";
    aviso("Os candidatos marcados não têm perfil neste recorte.");
    return;
  }
  aviso("");
  var h = [];
  ["genero", "faixa", "escol"].forEach(function(dim){
    var cats = {};
    sqs.forEach(function(sq){
      ((f.c[sq].d || {})[dim] || []).forEach(function(par){
        cats[par[0]] = cats[par[0]] || {};
        cats[par[0]][sq] = par[1];
      });
    });
    var lista = Object.keys(cats).sort(function(a, b){
      return (cats[b][sqs[0]] || 0) - (cats[a][sqs[0]] || 0);
    });
    if(!lista.length) return;
    h.push('<h3 style="margin:14px 0 6px">' + DIM_TITULO[dim] +
      "</h3>");
    h.push("<table><thead><tr><th>Categoria</th>");
    sqs.forEach(function(sq){
      h.push('<th class="num">' + esc(f.c[sq].n) + "</th>" +
        '<th class="c-bar"></th>');
    });
    h.push("</tr></thead><tbody>");
    lista.forEach(function(cat){
      h.push("<tr><td>" + esc(cat) + "</td>");
      sqs.forEach(function(sq){
        var v = cats[cat][sq] || 0;
        h.push('<td class="num">' +
          (100 * v).toLocaleString("pt-BR",
            {minimumFractionDigits: 1, maximumFractionDigits: 1}) +
          "%</td>");
        h.push('<td class="c-bar">' + barra(v, 1) + "</td>");
      });
      h.push("</tr>");
    });
    h.push("</tbody></table>");
  });
  h.push('<div style="margin-top:10px;font-size:12.5px;' +
    'color:var(--tinta2)">Perfil do ELEITORADO APTO das seções onde ' +
    "o candidato recebeu votos, ponderado pelos votos dele em cada " +
    "seção (1º turno). É uma medida descritiva do território do voto " +
    "— não identifica o voto de ninguém: o voto é secreto.</div>");
  el("pg-tabela").innerHTML = h.join("");
  var lat = [];
  sqs.forEach(function(sq){
    lat.push(kpi(f.c[sq].v || 0, "votos cobertos — " + f.c[sq].n +
      " (" + (f.c[sq].p || "") + ")"));
  });
  el("pg-lateral").innerHTML = lat.join("");
}

/* ------------- comparativo entre municípios ------------- */
function chipsMun(){
  var h = ['<div class="modo-botoes nao-imprime">'];
  h.push('<button data-acao="mun-add">+ Adicionar ' +
    (estado.mun ? esc(nomeMun(estado.mun)) : "município") + "</button>");
  estado.muns.forEach(function(cd){
    h.push('<button data-acao="mun-del" data-cd="' + esc(cd) +
      '" title="remover">' + esc(nomeMun(cd)) + " ×</button>");
  });
  if(estado.muns.length){
    h.push('<button data-acao="mun-limpar">Limpar</button>');
  }
  h.push("</div>");
  return h.join("");
}
function desenhaCompMun(f){
  ajustaTurnos({turnos: [1]});
  var h = [chipsMun()];
  var cds = estado.muns.filter(function(cd){
    return f.m[String(cd)] && f.m[String(cd)][estado.ano]; });
  if(cds.length < 2){
    h.push('<p style="padding:10px;color:#5B6478">Escolha o município ' +
      "no filtro acima e clique em <b>+ Adicionar</b> — até " +
      MAX_MUN + " municípios, no mínimo 2.</p>");
    el("pg-tabela").innerHTML = h.join("");
    el("pg-lateral").innerHTML = "";
    aviso(estado.muns.length && cds.length < estado.muns.length
      ? "Algum município escolhido não tem dados em " + estado.ano + "."
      : "");
    return;
  }
  aviso("");
  var cargoRef = CARGO_REF[estado.ano] || 11;
  function d(cd){ return f.m[String(cd)][estado.ano]; }
  var linhas = [
    ["Eleitorado apto", function(v){ return num(v[0]); }],
    ["Comparecimento", function(v){
      return num(v[1]) + " (" + pct(v[1], v[0]) + ")"; }],
    ["Abstenção", function(v){ return pct(v[0] - v[1], v[0]); }],
    ["Votos válidos", function(v){ return num(v[2]); }],
    ["Brancos + nulos", function(v){
      return num(v[3]) + " (" + pct(v[3], v[1]) + ")"; }],
    ["Locais de votação", function(v){ return num(v[4]); }],
    ["Seções eleitorais", function(v){ return num(v[5]); }],
    ["Eleitores por seção", function(v){
      return v[5] ? num(Math.round(v[0] / v[5])) : "—"; }],
    ["Mais votado (" + esc(idx.cargos[cargoRef] || "") + ")",
     function(v){
       return v[8] ? esc(v[8][0]) + " (" + esc(v[8][1]) + ") — " +
         num(v[8][2]) : "—"; }]
  ];
  h.push("<table><thead><tr><th>Indicador</th>");
  cds.forEach(function(cd){
    h.push('<th class="num">' + esc(nomeMun(cd)) + "</th>");
  });
  h.push("</tr></thead><tbody>");
  linhas.forEach(function(ln){
    h.push("<tr><td>" + ln[0] + "</td>");
    cds.forEach(function(cd){
      h.push('<td class="num">' + ln[1](d(cd)) + "</td>");
    });
    h.push("</tr>");
  });
  h.push("</tbody></table>");
  ["genero", "faixa", "escol"].forEach(function(dim){
    var cats = {};
    cds.forEach(function(cd){
      var perf = d(cd)[7] || {};
      (perf[dim] || []).forEach(function(par){
        cats[par[0]] = cats[par[0]] || {};
        cats[par[0]][cd] = par[1];
      });
    });
    var lista = Object.keys(cats).sort(function(a, b){
      return (cats[b][cds[0]] || 0) - (cats[a][cds[0]] || 0); });
    if(!lista.length) return;
    h.push('<h3 style="margin:14px 0 6px">' + DIM_TITULO[dim] +
      " do eleitorado</h3><table><thead><tr><th>Categoria</th>");
    cds.forEach(function(cd){
      h.push('<th class="num">' + esc(nomeMun(cd)) + "</th>");
    });
    h.push("</tr></thead><tbody>");
    lista.forEach(function(cat){
      h.push("<tr><td>" + esc(cat) + "</td>");
      cds.forEach(function(cd){
        var v = cats[cat][cd];
        h.push('<td class="num">' + (v === undefined ? "—" :
          (100 * v).toLocaleString("pt-BR",
            {minimumFractionDigits: 1, maximumFractionDigits: 1}) +
          "%") + "</td>");
      });
      h.push("</tr>");
    });
    h.push("</tbody></table>");
  });
  h.push('<div style="margin-top:10px;font-size:12.5px;' +
    'color:var(--tinta2)">Indicadores do 1º turno do cargo de ' +
    "referência do pleito (Prefeito em 2020/2024, Governador em 2022). " +
    "Abstenção sobre o eleitorado apto; brancos + nulos sobre o " +
    "comparecimento.</div>");
  el("pg-tabela").innerHTML = h.join("");
  el("pg-lateral").innerHTML = cds.map(function(cd){
    return kpi(d(cd)[0], "eleitores aptos — " + nomeMun(cd)); }).join("");
}

/* ---------------- panorama do município ---------------- */
function desenhaPanorama(f){
  ajustaTurnos({turnos: [1]});
  var d = f.m[String(estado.mun)];
  if(!d){
    el("pg-tabela").innerHTML = "";
    el("pg-lateral").innerHTML = "";
    aviso("Sem panorama para este município.");
    return;
  }
  aviso("");
  estado.ultimo = {tipo: "panorama", d: d};
  var anos = ["2020", "2022", "2024"];
  function cel(a, fn){
    var v = d[a];
    return v ? fn(v) : "—";
  }
  var linhas = [
    ["Eleitorado apto", function(v){ return num(v[0]); }],
    ["Comparecimento", function(v){
      return num(v[1]) + " (" + pct(v[1], v[0]) + ")"; }],
    ["Abstenção (%)", function(v){ return pct(v[0] - v[1], v[0]); }],
    ["Votos válidos", function(v){ return num(v[2]); }],
    ["Brancos + nulos (%)", function(v){
      return num(v[3]) + " (" + pct(v[3], v[1]) + ")"; }],
    ["Locais de votação", function(v){ return num(v[4]); }],
    ["Seções eleitorais", function(v){ return num(v[5]); }]
  ];
  var h = ["<table><thead><tr><th>Indicador</th>"];
  anos.forEach(function(a){ h.push('<th class="num">' + a + "</th>"); });
  h.push("</tr></thead><tbody>");
  linhas.forEach(function(ln){
    h.push("<tr><td>" + ln[0] + "</td>");
    anos.forEach(function(a){
      h.push('<td class="num">' + cel(a, ln[1]) + "</td>");
    });
    h.push("</tr>");
  });
  h.push("</tbody></table>");
  h.push('<div style="margin-top:10px;font-size:12.5px;' +
    'color:var(--tinta2)">Comparecimento, válidos e percentuais do ' +
    "1º turno do cargo de referência do pleito — Prefeito em " +
    "2020/2024 e Governador em 2022. Abstenção sobre o eleitorado " +
    "apto; brancos + nulos sobre o comparecimento.</div>");
  el("pg-tabela").innerHTML = h.join("");
  var ult = d["2024"] || d["2022"] || d["2020"];
  var lat2 = [kpi(ult ? ult[0] : 0,
                  "eleitores aptos no pleito mais recente")];
  var anoP = null;
  ["2024", "2022", "2020"].forEach(function(a){
    if(!anoP && d[a] && d[a][7]) anoP = a;
  });
  if(anoP){
    ["genero", "faixa", "escol"].forEach(function(dim){
      var lista = d[anoP][7][dim] || [];
      if(!lista.length) return;
      var hb = ['<div class="cartao rolagem"><div style="font-weight:' +
        '700;margin-bottom:6px">' + DIM_TITULO[dim] +
        " do eleitorado (" + anoP + ")</div><table><tbody>"];
      lista.forEach(function(par){
        hb.push("<tr><td>" + esc(par[0]) + '</td><td class="num">' +
          (100 * par[1]).toLocaleString("pt-BR",
            {minimumFractionDigits: 1, maximumFractionDigits: 1}) +
          '%</td><td class="c-bar">' + barra(par[1], 1) +
          "</td></tr>");
      });
      hb.push("</tbody></table></div>");
      lat2.push(hb.join(""));
    });
  }
  el("pg-lateral").innerHTML = lat2.join("");
}

/* ------- mini-mapa ao passar o mouse no nome do candidato ------- */
var miniLeaflet = null, miniTimer = null, miniAlvo = null;

function fechaMiniMapa(){
  clearTimeout(miniTimer);
  miniAlvo = null;
  var p = el("minimapa-pop");
  if(p) p.style.display = "none";
  if(miniLeaflet){ miniLeaflet.remove(); miniLeaflet = null; }
}

function abreMiniMapa(alvo, x, y){
  if(typeof L === "undefined") return;
  var sq = alvo.dataset.sq;
  var p2 = paginaAtual();
  var arq = estado.mun ? arqSc(p2.cargo, estado.mun) : arqMn(p2.cargo);
  pega(arq).then(function(f){
    if(miniAlvo !== alvo) return;   // o mouse já saiu dali
    var c = f.c[sq];
    if(!c) return;
    var pontos = [], total = 0;
    if(estado.mun){
      var porLi = {};
      for(var i = 0; i < c.v.length; i += 2){
        var s = f.S[c.v[i]];
        porLi[s[2]] = (porLi[s[2]] || 0) + c.v[i + 1];
        total += c.v[i + 1];
      }
      Object.keys(porLi).forEach(function(li){
        var L2 = f.L[li];
        if(L2[3] !== null && L2[3] !== undefined &&
           L2[4] !== null && L2[4] !== undefined)
          pontos.push([L2[3], L2[4], porLi[li]]);
      });
    } else {
      var ctr = (idx.ctr || {})[estado.uf] || {};
      for(var j = 0; j < c.v.length; j += 2){
        var mm = f.m[c.v[j]];
        total += c.v[j + 1];
        var cc = ctr[String(mm[0])];
        if(cc) pontos.push([cc[0], cc[1], c.v[j + 1]]);
      }
    }
    if(!pontos.length) return;
    var pop = el("minimapa-pop");
    if(!pop){
      pop = document.createElement("div");
      pop.id = "minimapa-pop";
      pop.innerHTML = '<div class="mm-titulo"></div>' +
        '<div id="minimapa-mapa"></div>';
      document.body.appendChild(pop);
    }
    pop.querySelector(".mm-titulo").textContent =
      (c.n || "") + " — " + num(total) +
      (estado.mun ? " votos no município (por local)"
                  : " votos (por município)");
    pop.style.display = "block";
    pop.style.left = Math.max(6,
      Math.min(x + 18, window.innerWidth - 360)) + "px";
    pop.style.top = Math.max(6,
      Math.min(y + 12, window.innerHeight - 300)) + "px";
    if(miniLeaflet){ miniLeaflet.remove(); miniLeaflet = null; }
    var mapa = L.map("minimapa-mapa", {zoomControl: false,
      attributionControl: false, dragging: false,
      scrollWheelZoom: false, doubleClickZoom: false});
    miniLeaflet = mapa;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {maxZoom: 19}).addTo(mapa);
    var maxV = 0, lim = [];
    pontos.forEach(function(pt){ if(pt[2] > maxV) maxV = pt[2]; });
    pontos.forEach(function(pt){
      lim.push([pt[0], pt[1]]);
      L.circleMarker([pt[0], pt[1]], {
        radius: 2 + 10 * Math.sqrt(pt[2] / (maxV || 1)),
        color: "#FFFFFF", weight: 1, fillColor: "#6366F1",
        fillOpacity: 0.75}).addTo(mapa);
    });
    mapa.fitBounds(lim, {padding: [14, 14]});
  }).catch(function(){});
}

document.addEventListener("mouseover", function(ev){
  var alvo = ev.target.closest ? ev.target.closest(".minimapa-alvo")
                               : null;
  if(!alvo) return;
  miniAlvo = alvo;
  clearTimeout(miniTimer);
  var x = ev.clientX, y = ev.clientY;
  miniTimer = setTimeout(function(){ abreMiniMapa(alvo, x, y); }, 250);
});
document.addEventListener("mouseout", function(ev){
  if(ev.target.closest && ev.target.closest(".minimapa-alvo"))
    fechaMiniMapa();
});

function desenhaCombinado(fEst, fFed, porMunicipio){
  var linhas = [], total = 0;
  [[fEst, "Deputado Estadual"], [fFed, "Deputado Federal"]]
    .forEach(function(par){
      var f = par[0], cargo = par[1];
      if(porMunicipio){
        Object.keys(f.c).forEach(function(sq){
          var c = f.c[sq], v = somaPares(c.v);
          total += v;
          linhas.push({nome: c.n, cargo: cargo, partido: c.p, votos: v});
        });
      } else {
        total += f.total;
        f.l.forEach(function(x){
          linhas.push({nome: x[0], cargo: cargo, partido: x[1],
                       votos: x[3]});
        });
      }
    });
  linhas.sort(function(a, b){ return b.votos - a.votos; });
  var mostradas = linhas.slice(0, 300);
  estado.ultimo = {tipo: "combinado", linhas: mostradas, total: total};
  aviso(linhas.length > 300 ? "Exibindo os 300 votáveis mais votados de " +
    num(linhas.length) + "." : "");
  var max = mostradas.length ? mostradas[0].votos : 0;
  var h = ['<table><thead><tr><th>Votável</th><th>Cargo</th>',
    "<th>Partido</th>", '<th class="num">Votos</th>',
    '<th class="c-bar"></th><th class="num">% apurados</th>',
    "</tr></thead><tbody>"];
  mostradas.forEach(function(ln){
    h.push("<tr><td>" + esc(ln.nome) + "</td><td>" + esc(ln.cargo) +
      "</td><td>" + esc(ln.partido) + '</td><td class="num"><b>' +
      num(ln.votos) + '</b></td><td class="c-bar">' +
      barra(ln.votos, max) + '</td><td class="num">' +
      pct(ln.votos, total) + "</td></tr>");
  });
  h.push("</tbody></table>");
  el("pg-tabela").innerHTML = h.join("");
  el("pg-lateral").innerHTML = kpi(total,
    "soma de votos apurados (federal + estadual)" +
    (porMunicipio ? " no município" : ""));
}

/* --------- casadinha: limite máximo aritmético por seção --------- */
function desenhaCasadinhaMun(mnEst, mnFed){
  var ce = mnEst.c[estado.selEst], cf = mnFed.c[estado.selFed];
  if(!ce || !cf){
    el("pg-tabela").innerHTML = "";
    el("pg-lateral").innerHTML = "";
    aviso("Candidato sem votos no recorte.");
    return;
  }
  var e = paresParaMapa(ce.v), f = paresParaMapa(cf.v);
  var linhas = {}, tE = 0, tF = 0, tC = 0;
  function nomeM(mn, i){ return mn.m[i][1]; }
  Object.keys(e).forEach(function(i){
    var g = linhas[nomeM(mnEst, i)] || (linhas[nomeM(mnEst, i)] =
      {nome: nomeM(mnEst, i), est: 0, fed: 0, casada: 0});
    g.est += e[i]; tE += e[i];
  });
  Object.keys(f).forEach(function(i){
    var n = nomeM(mnFed, i);
    var g = linhas[n] || (linhas[n] = {nome: n, est: 0, fed: 0, casada: 0});
    g.fed += f[i]; tF += f[i];
  });
  Object.keys(linhas).forEach(function(k){
    var g = linhas[k];
    g.casada = Math.min(g.est, g.fed);
    tC += g.casada;
  });
  var lista = Object.keys(linhas).map(function(k){ return linhas[k]; })
    .sort(function(a, b){ return b.casada - a.casada; });
  desenhaCasadinhaTabela(lista, "municipio", ce, cf, tE, tF, tC,
    pearson(lista.map(function(g){ return [g.est, g.fed]; })));
}

function desenhaCasadinhaSecao(scEst, scFed){
  var ce = scEst.c[estado.selEst], cf = scFed.c[estado.selFed];
  var e = ce ? paresParaMapa(ce.v) : {};
  var f = cf ? paresParaMapa(cf.v) : {};
  var linhas = {}, tE = 0, tF = 0, tC = 0;
  function chave(sc, si){
    var s = sc.S[si];
    return s[0] + "-" + s[1];
  }
  Object.keys(e).forEach(function(si){
    var s = scEst.S[si], k = chave(scEst, si);
    var g = linhas[k] || (linhas[k] = {zona: s[0], secao: s[1],
      local: scEst.L[s[2]][0], est: 0, fed: 0, casada: 0});
    g.est += e[si]; tE += e[si];
  });
  Object.keys(f).forEach(function(si){
    var s = scFed.S[si], k = chave(scFed, si);
    var g = linhas[k] || (linhas[k] = {zona: s[0], secao: s[1],
      local: scFed.L[s[2]][0], est: 0, fed: 0, casada: 0});
    g.fed += f[si]; tF += f[si];
  });
  var vals = [];
  Object.keys(linhas).forEach(function(k){
    var g = linhas[k];
    g.casada = Math.min(g.est, g.fed);
    tC += g.casada;
    vals.push([g.est, g.fed]);
  });
  var lista = Object.keys(linhas).map(function(k){ return linhas[k]; })
    .sort(function(a, b){ return b.casada - a.casada; });
  desenhaCasadinhaTabela(lista, "secao", ce || {n: "?", p: ""},
    cf || {n: "?", p: ""}, tE, tF, tC, pearson(vals));
}

function pearson(vals){
  var n = vals.length;
  if(n < 3) return null;
  var sx = 0, sy = 0;
  vals.forEach(function(v){ sx += v[0]; sy += v[1]; });
  var mx = sx/n, my = sy/n, sxy = 0, sxx = 0, syy = 0;
  vals.forEach(function(v){
    sxy += (v[0]-mx)*(v[1]-my); sxx += (v[0]-mx)*(v[0]-mx);
    syy += (v[1]-my)*(v[1]-my);
  });
  if(sxx <= 0 || syy <= 0) return null;
  return sxy/Math.sqrt(sxx*syy);
}

function desenhaCasadinhaTabela(lista, base, ce, cf, tE, tF, tC, r){
  estado.ultimo = {tipo: "casadinha", base: base, linhas: lista,
                   ce: ce, cf: cf, tE: tE, tF: tF, tC: tC};
  aviso("");
  var max = lista.length ? lista[0].casada : 0;
  var h = ["<table><thead><tr>"];
  if(base === "secao"){
    h.push('<th class="num">Zona</th><th class="num">Seção</th>');
    h.push("<th>Local</th>");
  } else { h.push("<th>Município</th>"); }
  h.push('<th class="num">' + esc(ce.n) + " (Est.)</th>");
  h.push('<th class="num">' + esc(cf.n) + " (Fed.)</th>");
  h.push('<th class="num">Casadinha (máx.)</th><th class="c-bar"></th>');
  h.push("</tr></thead><tbody>");
  lista.forEach(function(g){
    h.push("<tr>");
    if(base === "secao"){
      h.push('<td class="num">' + num(g.zona) + "</td>");
      h.push('<td class="num">' + num(g.secao) + "</td>");
      h.push("<td>" + esc(g.local) + "</td>");
    } else { h.push("<td>" + esc(g.nome) + "</td>"); }
    h.push('<td class="num">' + num(g.est) + "</td>");
    h.push('<td class="num">' + num(g.fed) + "</td>");
    h.push('<td class="num"><b>' + num(g.casada) + "</b></td>");
    h.push('<td class="c-bar">' + barra(g.casada, max) + "</td>");
    h.push("</tr>");
  });
  h.push("</tbody></table>");
  el("pg-tabela").innerHTML = h.join("");
  var lat = [kpi(tC, base === "secao"
    ? "casadinha máxima — cálculo por seção"
    : "casadinha máxima — cálculo por município")];
  lat.push('<div class="cartao"><div style="font-weight:700">' +
    esc(ce.n) + ' <span style="color:#8A93A8">Estadual · ' +
    esc(ce.p) + '</span></div><div class="kpi" style="font-size:24px">' +
    num(tE) + '</div><div style="color:#8A93A8;font-size:12px">' +
    "casadinha ≤ " + pct(tC, tE) + " dos votos dele</div></div>");
  lat.push('<div class="cartao"><div style="font-weight:700">' +
    esc(cf.n) + ' <span style="color:#8A93A8">Federal · ' +
    esc(cf.p) + '</span></div><div class="kpi" style="font-size:24px">' +
    num(tF) + '</div><div style="color:#8A93A8;font-size:12px">' +
    "casadinha ≤ " + pct(tC, tF) + " dos votos dele</div></div>");
  lat.push('<div class="cartao"><div style="font-weight:700">' +
    (r === null ? "Casadinha" : "Correlação por seção (Pearson)") +
    '</div>' + (r === null ? "" : '<div class="kpi" ' +
      'style="font-size:24px">' + r.toLocaleString("pt-BR",
        {minimumFractionDigits:2, maximumFractionDigits:2}) + "</div>") +
    '<div style="color:#8A93A8;font-size:12px">Limite MÁXIMO ' +
    "aritmético: soma, em cada " + (base === "secao" ? "seção" :
      "município") + ", do menor entre as duas votações. O voto é " +
    "secreto — não é contagem de votos casados reais." +
    (base === "secao" ? "" : " Escolha um município para o cálculo " +
      "por seção, que é mais restrito e portanto mais informativo.") +
    "</div></div>");
  el("pg-lateral").innerHTML = lat.join("");
}

/* ---------------- busca de candidatos ---------------- */
function buscaCandidatos(){
  var p = paginaAtual();
  var q = el("c-cand-busca").value.trim().toUpperCase();
  var arquivos;
  if(p.tipo === "casadinha"){
    arquivos = estado.mun
      ? [arqSc(7, estado.mun), arqSc(6, estado.mun)]
      : [arqMn(7), arqMn(6)];
  } else if(p.tipo === "cidade"){
    arquivos = [arqMn(p.cargo)];
  } else {
    arquivos = estado.mun ? [arqSc(p.cargo, estado.mun)]
      : [arqMn(p.cargo)];
  }
  var idBusca = ++buscaSeq;
  Promise.all(arquivos.map(pega)).then(function(fs){
    if(idBusca !== buscaSeq) return;   // resposta velha: descartar
    var achados = [];
    fs.forEach(function(f, ordem){
      var cargo = (p.tipo === "casadinha") ? (ordem === 0 ? 7 : 6)
        : p.cargo;
      Object.keys(f.c).forEach(function(sq){
        if(sq.charAt(0) === "e") return;
        var c = f.c[sq];
        if(q){
          var casa = (c.n || "").toUpperCase().indexOf(q) >= 0 ||
            String(c.nr).indexOf(q) === 0;
          if(!casa) return;
        }
        achados.push({sq: sq, cargo: cargo, n: c.n, nr: c.nr, p: c.p,
                      si: c.si, votos: somaPares(c.v)});
      });
    });
    achados.sort(function(a, b){ return b.votos - a.votos; });
    achados = achados.slice(0, 40);
    var casad = (p.tipo === "casadinha");
    if(!achados.length){
      el("c-cand-lista").innerHTML =
        '<p style="padding:10px">Nenhum candidato encontrado.</p>';
      return;
    }
    var h = ['<table><thead><tr><th></th><th class="num">Nº</th>',
      "<th>Nome de urna</th>"];
    if(casad) h.push("<th>Cargo</th>");
    h.push("<th>Partido</th><th>Situação</th>",
      '<th class="num">Votos</th></tr></thead><tbody>');
    achados.forEach(function(c){
      var marc = (estado.sel[c.sq] || estado.selEst === c.sq ||
        estado.selFed === c.sq) ? " checked" : "";
      h.push('<tr><td><input type="checkbox" data-acao="marcar" ' +
        'data-sq="' + c.sq + '" data-cargo="' + c.cargo + '"' + marc +
        "></td>");
      h.push('<td class="num">' + esc(c.nr) + "</td>");
      h.push("<td>" + esc(c.n) + "</td>");
      if(casad) h.push("<td>" + (c.cargo === 7 ? "Estadual" : "Federal") +
        "</td>");
      h.push("<td>" + esc(c.p) + "</td>");
      h.push("<td>" + situHtml(c.si) + "</td>");
      h.push('<td class="num">' + num(c.votos) + "</td></tr>");
    });
    h.push("</tbody></table>");
    el("c-cand-lista").innerHTML = h.join("");
  }).catch(function(e){
    if(idBusca !== buscaSeq) return;
    aviso("Falha ao buscar: " + e.message);
  });
}
function atualizaSelecionados(){
  var p = paginaAtual();
  el("c-sel-n").textContent = (p && p.tipo === "casadinha")
    ? ((estado.selEst ? 1 : 0) + (estado.selFed ? 1 : 0))
    : Object.keys(estado.sel).length;
}

/* ---------------- exportação CSV ---------------- */
function baixaCsv(nome, linhas){
  var txt = "﻿" + linhas.map(function(l){
    return l.map(function(c){
      var s = (c === null || c === undefined) ? "" : String(c);
      return (s.indexOf(";") >= 0 || s.indexOf('"') >= 0 ||
              s.indexOf("\n") >= 0 || s.indexOf("\r") >= 0)
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(";");
  }).join("\r\n");
  var a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([txt], {type: "text/csv"}));
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
// Exportação SUSPENSA a pedido do titular (29/08/2026) — o botão foi
// removido do index.html; esta trava cobre também chamadas diretas.
// Para reativar: EXPORTAR_ATIVO = true e devolver o botão.
var EXPORTAR_ATIVO = false;

function exportar(){
  if(!EXPORTAR_ATIVO){
    aviso("A exportação de dados está temporariamente suspensa.");
    return;
  }
  var u = estado.ultimo;
  if(!u){ return; }
  var p = paginaAtual();
  var cab = ["Eleições CE·BA — fonte: TSE Dados Abertos, extração " +
    idx.extracao];
  var l = [cab, [p.titulo + " — " + estado.ano + " " + estado.uf +
    (estado.mun ? " — " + nomeMun(estado.mun) : "")], []];
  if(u.tipo === "ranking"){
    l.push(["VOTÁVEL", "PARTIDO", "SITUAÇÃO", "VOTOS"]);
    u.dados.l.forEach(function(x){ l.push([x[0], x[1], x[2], x[3]]); });
    l.push([], ["TOTAL", "", "", u.dados.total]);
  } else if(u.tipo === "cidade"){
    l.push(["MUNICÍPIO", "VOTOS", "ZONA URBANA", "ZONA RURAL"]);
    u.linhas.forEach(function(x){
      l.push([x[0], x[1], x[2], x[3]]); });
    l.push([], ["TOTAL", u.total]);
  } else if(u.tipo === "secao"){
    l.push(["ZONA", "SEÇÃO", "LOCAL", "ENDEREÇO", "VOTOS"]);
    u.linhas.forEach(function(x){
      l.push([x.zona, x.secao, x.local, x.ende, x.votos]); });
    l.push([], ["TOTAL", "", "", "", u.total]);
    [["RESUMO URBANA × RURAL", u.resumos.area, "ÁREA"],
     ["RESUMO POR LOCAL DE VOTAÇÃO", u.resumos.local, "LOCAL"],
     ["RESUMO POR ENDEREÇO", u.resumos.endereco, "ENDEREÇO"]
    ].forEach(function(bloco){
      l.push([], [bloco[0]], [bloco[2], "LOCAIS", "SEÇÕES", "VOTOS"]);
      bloco[1].forEach(function(g){
        l.push([g.nome, g.locais, g.secoes, g.votos]); });
    });
  } else if(u.tipo === "comparativo"){
    var nomes = u.colunas.map(function(c){
      return c.nome + " (" + c.partido + ")"; });
    if(u.base === "secao"){
      l.push([], ["COMPARATIVO POR LOCAL DE VOTAÇÃO"]);
      l.push(["LOCAL", "ENDEREÇO"].concat(nomes));
      u.linhasLocal.forEach(function(ln){
        l.push([ln.nome, ln.ende].concat(u.colunas.map(function(c){
          return ln.v[c.sq] || 0; }))); });
      l.push([], ["COMPARATIVO POR SEÇÃO"]);
      l.push(["ZONA", "SEÇÃO", "LOCAL"].concat(nomes));
      u.linhas.forEach(function(ln){
        l.push([ln.zona, ln.secao, ln.local].concat(
          u.colunas.map(function(c){ return ln.v[c.sq] || 0; }))); });
    } else {
      l.push(["MUNICÍPIO"].concat(nomes));
      u.linhas.forEach(function(ln){
        l.push([ln.nome].concat(u.colunas.map(function(c){
          return ln.v[c.sq] || 0; }))); });
    }
  } else if(u.tipo === "mapa"){
    l.push(["LOCAL", "BAIRRO", "ENDEREÇO", "LATITUDE", "LONGITUDE",
            "VOTOS", "NOMINAIS DO LOCAL"]);
    u.linhas.forEach(function(g){
      l.push([g.nome, g.bairro, g.ende, g.lat, g.lon, g.sel,
              g.nominais]); });
    l.push([], ["TOTAL", "", "", "", "", u.total]);
  } else if(u.tipo === "combinado"){
    l.push(["VOTÁVEL", "CARGO", "PARTIDO", "VOTOS"]);
    u.linhas.forEach(function(x){
      l.push([x.nome, x.cargo, x.partido, x.votos]); });
    l.push([], ["TOTAL", "", "", u.total]);
  } else if(u.tipo === "casadinha"){
    l.push(["Casadinha = limite MÁXIMO aritmético (soma dos mínimos). " +
      "O voto é secreto; não é contagem real."], []);
    var frente = (u.base === "secao") ? ["ZONA", "SEÇÃO", "LOCAL"]
      : ["MUNICÍPIO"];
    l.push(frente.concat([u.ce.n + " (EST)", u.cf.n + " (FED)",
      "CASADINHA (MÁX)"]));
    u.linhas.forEach(function(g){
      var f = (u.base === "secao") ? [g.zona, g.secao, g.local] : [g.nome];
      l.push(f.concat([g.est, g.fed, g.casada])); });
    l.push([], (u.base === "secao" ? ["TOTAL", "", ""] : ["TOTAL"])
      .concat([u.tE, u.tF, u.tC]));
  } else if(u.tipo === "panorama"){
    l.push(["INDICADOR", "2020", "2022", "2024"]);
    [["Eleitorado apto", function(v){ return v[0]; }],
     ["Comparecimento", function(v){ return v[1]; }],
     ["Abstenção (%)", function(v){
       return v[0] ? (100 * (v[0] - v[1]) / v[0]).toFixed(1) : ""; }],
     ["Votos válidos", function(v){ return v[2]; }],
     ["Brancos + nulos", function(v){ return v[3]; }],
     ["Brancos + nulos (%)", function(v){
       return v[1] ? (100 * v[3] / v[1]).toFixed(1) : ""; }],
     ["Locais de votação", function(v){ return v[4]; }],
     ["Seções eleitorais", function(v){ return v[5]; }]
    ].forEach(function(ln){
      l.push([ln[0]].concat(["2020", "2022", "2024"].map(function(a){
        return u.d[a] ? ln[1](u.d[a]) : ""; })));
    });
    l.push([], ["1º turno; cargo de referência: Prefeito em 2020/2024" +
      ", Governador em 2022"]);
  }
  baixaCsv("eleicoes_" + p.tipo + "_" + estado.ano + "_" + estado.uf +
    ".csv", l);
}

/* ---------------- eventos ---------------- */
document.addEventListener("click", function(ev){
  var alvo = ev.target.closest("[data-acao]");
  if(!alvo) return;
  var acao = alvo.dataset.acao;
  if(acao === "pagina"){ abrePagina(alvo.dataset.id); }
  else if(acao === "mapa-tela"){
    var cxm = document.getElementById("mapa-caixa");
    if(!cxm) return;
    if(document.fullscreenElement || cxm.classList.contains("tela-cheia")){
      if(document.fullscreenElement) document.exitFullscreen();
      cxm.classList.remove("tela-cheia");
      if(mapaLeaflet)
        setTimeout(function(){ mapaLeaflet.invalidateSize(); }, 120);
    } else {
      // plano B: se o navegador negar a API, painel fixo na janela
      var pr = cxm.requestFullscreen ? cxm.requestFullscreen()
                                     : Promise.reject();
      Promise.resolve(pr).catch(function(){
        cxm.classList.add("tela-cheia");
        if(mapaLeaflet)
          setTimeout(function(){ mapaLeaflet.invalidateSize(); }, 120);
      });
    }
  }
  else if(acao === "marcar"){
    var p = paginaAtual();
    if(p.tipo === "casadinha"){
      var cg = parseInt(alvo.dataset.cargo, 10);
      var campo = (cg === 7) ? "selEst" : "selFed";
      if(alvo.checked){
        estado[campo] = alvo.dataset.sq;
        el("c-cand-lista").querySelectorAll(
          'input[data-cargo="' + cg + '"]').forEach(function(i){
            if(i !== alvo) i.checked = false; });
      } else if(estado[campo] === alvo.dataset.sq){ estado[campo] = null; }
    } else {
      if(alvo.checked){
        var teto = (p.tipo === "perfilvoto") ? 2 : MAX_SEL;
        if(Object.keys(estado.sel).length >= teto){
          alvo.checked = false;
          aviso("Máximo de " + teto + " candidatos nesta tela. " +
            "Desmarque um para escolher outro.");
          return;
        }
        estado.sel[alvo.dataset.sq] = 1;
      } else { delete estado.sel[alvo.dataset.sq]; }
    }
    atualizaSelecionados();
    consultar();
  }
  else if(acao === "limpar-sel"){
    estado.sel = {}; estado.selEst = null; estado.selFed = null;
    atualizaSelecionados();
    el("c-cand-lista").querySelectorAll("input").forEach(function(i){
      i.checked = false; });
    consultar();
  }
  else if(acao === "modo-mapa"){
    modoMapa = alvo.dataset.modo;
    consultar();
  }
  else if(acao === "ordem-custo"){
    ordemCusto = alvo.dataset.ordem;
    consultar();
  }
  else if(acao === "mun-add"){
    if(!estado.mun){
      aviso("Escolha um município no filtro acima antes de adicionar.");
      return;
    }
    if(estado.muns.indexOf(estado.mun) >= 0){
      aviso("Esse município já está na comparação."); return;
    }
    if(estado.muns.length >= MAX_MUN){
      aviso("Máximo de " + MAX_MUN + " municípios. Remova um antes.");
      return;
    }
    estado.muns.push(estado.mun);
    consultar();
  }
  else if(acao === "mun-del"){
    estado.muns = estado.muns.filter(function(cd){
      return String(cd) !== String(alvo.dataset.cd); });
    consultar();
  }
  else if(acao === "mun-limpar"){ estado.muns = []; consultar(); }
  else if(acao === "imprimir"){ window.print(); }
  else if(acao === "exportar"){ exportar(); }
});

/* ---------------- início ---------------- */
fetch("d/idx.json").then(function(r){ return r.json(); })
  .then(function(dados){
    idx = dados;
    el("r-extracao").textContent = idx.extracao;
    el("c-extracao").textContent = idx.extracao;
    idx.ufs.forEach(function(u){
      var o = document.createElement("option");
      o.value = u; o.textContent = u; el("f-uf").appendChild(o);
    });
    Object.keys(idx.pleitos).sort().forEach(function(a){
      var o = document.createElement("option");
      o.value = a; o.textContent = a; el("f-ano").appendChild(o);
    });
    el("f-ano").value = estado.ano;
    el("f-uf").value = estado.uf;
    desenhaMunicipios("");

    el("f-ano").addEventListener("change", function(){
      estado.ano = this.value; estado.mun = "";
      desenhaMunicipios(el("c-mun-busca").value);
      abrePagina(paginas()[0].id);
    });
    el("f-uf").addEventListener("change", function(){
      estado.uf = this.value; estado.mun = "";
      estado.muns = [];   // códigos são de outra UF
      desenhaMunicipios(el("c-mun-busca").value);
      abrePagina(estado.pagina);
    });
    el("c-mun-busca").addEventListener("input", function(){
      desenhaMunicipios(this.value);
    });
    el("c-mun").addEventListener("change", function(){
      estado.mun = this.value;
      if(turnosDisponiveis(paginaAtual().cargo).indexOf(estado.turno) < 0){
        estado.turno = 1;
      }
      ajustaTurnos(paginaAtual().cargo);
      if(el("c-cand-busca").value) buscaCandidatos();
      consultar();
    });
    el("c-turno").addEventListener("change", function(){
      estado.turno = parseInt(this.value, 10); consultar();
    });
    el("c-cand-busca").addEventListener("input", function(){
      clearTimeout(buscaTimer);
      buscaTimer = setTimeout(buscaCandidatos, 250);
    });
    el("c-cand-busca").addEventListener("keydown", function(ev){
      if(ev.key === "Enter") buscaCandidatos();
    });

    abrePagina(paginas()[0].id);
  })
  .catch(function(e){
    document.getElementById("pg-tabela").innerHTML =
      '<p style="padding:12px">Não foi possível carregar os dados: ' +
      esc(e.message) + "</p>";
  });
