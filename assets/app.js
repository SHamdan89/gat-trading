/* gat.trading — page renderer. Reads four stored files and nothing else:
   data/latest.json, data/brief/latest.json, data/weekly/latest.json,
   data/alpha/latest.json. No API is called per visitor. The look is the
   Fable redesign; every figure still comes from the publishers' files. */
(function () {
  "use strict";

  /* ---------- helpers ------------------------------------------------------ */
  const $ = id => document.getElementById(id);
  function el(tag, cls, txt) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt !== undefined && txt !== null) n.textContent = txt;
    return n;
  }
  function svgel(markup) {
    const d = document.createElement("div");
    d.innerHTML = markup.trim();
    return d.firstChild;
  }
  function isNum(v) { return v !== null && v !== undefined && !isNaN(v); }
  function fmtPrice(v, currency) {
    if (!isNum(v)) return null;
    if (currency === "RATIO") return v.toFixed(2) + "×";
    if (currency === "USD_BN") {
      return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 1 }) + "B";
    }
    const d = Math.abs(v) >= 1 ? 2 : (Math.abs(v) >= 0.01 ? 4 : 6);
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtLevel(v) {
    if (!isNum(v)) return "—";
    const d = Math.abs(v) >= 1000 ? 0 : (Math.abs(v) >= 10 ? 2 : 4);
    return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtPct(v, dp) { return (v > 0 ? "+" : "") + v.toFixed(dp === undefined ? 2 : dp) + "%"; }
  function dirOf(v) { return v > 0.005 ? "up" : (v < -0.005 ? "dn" : "flat"); }
  function dateGB(d) { return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  function timeUTC(d) { return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }); }
  function dateLong(s) {
    const d = new Date(s + "T12:00:00Z");
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  function domainOf(url) {
    try { return String(url).split("/")[2].replace(/^www\./, "").split(".")[0] || "link"; } catch (e) { return "link"; }
  }
  function sub(host, bits) {
    host.innerHTML = "";
    bits.filter(b => b && b[0]).forEach((b, i) => {
      if (i) host.appendChild(el("span", "sep"));
      host.appendChild(el("span", b[1] ? "num" : null, b[0]));
    });
  }
  function pctSpan(v, dp) { return el("span", "num " + dirOf(v), fmtPct(v, dp)); }
  function extLink(text, href, cls) {
    const a = el("a", cls || null, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer nofollow";
    return a;
  }
  function srcChip(s) {
    const a = extLink(null, s.url, "src");
    a.appendChild(el("span", "dm", domainOf(s.url)));
    a.appendChild(el("span", "tt", (s.title || "source") + (s.date ? " · " + s.date : "")));
    a.appendChild(svgel('<svg viewBox="0 0 24 24"><path d="M8 16 16 8M9 8h7v7"/></svg>'));
    return a;
  }
  function srcRow(list) {
    const row = el("div", "srcs");
    (list || []).forEach(s => { if (s && s.url) row.appendChild(srcChip(s)); });
    return row;
  }
  /* A dead job must announce itself. Without this the page would keep showing
     yesterday's numbers as though they were today's. */
  function stale(msg) {
    const b = el("div", "stale");
    b.setAttribute("role", "alert");
    b.appendChild(svgel('<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18.6a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>'));
    b.appendChild(el("p", null, msg));
    return b;
  }
  function notice(msg, boldLead) {
    const v = el("div", "notice");
    v.appendChild(svgel('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'));
    const p = el("p");
    if (boldLead) p.appendChild(el("b", null, boldLead + " "));
    p.appendChild(document.createTextNode(msg));
    v.appendChild(p);
    return v;
  }
  function emptyBox(title, paras, mutedMsg) {
    const e = el("div", "empty");
    e.appendChild(el("h3", null, title));
    (paras || []).forEach(t => e.appendChild(el("p", null, t)));
    if (mutedMsg) e.appendChild(el("p", "muted", mutedMsg));
    return e;
  }
  function hide(id) { const n = $(id); if (n) n.hidden = true; }
  function show(id) { const n = $(id); if (n) n.hidden = false; }

  /* ---------- theme -------------------------------------------------------- */
  (function theme() {
    const btns = { auto: $("th-auto"), light: $("th-light"), dark: $("th-dark") };
    function apply(mode) {
      if (mode === "auto") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", mode);
      Object.keys(btns).forEach(k => btns[k].setAttribute("aria-pressed", k === mode ? "true" : "false"));
      try { localStorage.setItem("gat-theme", mode); } catch (e) {}
    }
    let saved = "auto";
    try { saved = localStorage.getItem("gat-theme") || "auto"; } catch (e) {}
    if (!btns[saved]) saved = "auto";
    apply(saved);
    Object.keys(btns).forEach(k => btns[k].addEventListener("click", () => apply(k)));
  })();

  /* ---------- masthead: the tagline runs exactly as wide as the mark -------- */
  function fitTagline() {
    const logo = document.querySelector(".lockup .logo"), tag = document.querySelector(".lockup .tagline");
    if (!logo || !tag) return;
    tag.style.fontSize = "";                       /* measure at the stylesheet size */
    const cs = getComputedStyle(tag);
    const fs = parseFloat(cs.fontSize);
    const lsEm = (parseFloat(cs.letterSpacing) || 0) / fs;
    const wl = logo.getBoundingClientRect().width, wt = tag.getBoundingClientRect().width;
    if (!(fs > 0) || !(wl > 0) || !(wt > 0)) return;
    /* the text box carries one trailing letter-space; the visible ink ends before it */
    const k = wt / fs, target = wl / (k - lsEm);
    if (target > 0 && isFinite(target)) tag.style.fontSize = target.toFixed(3) + "px";
  }
  fitTagline();
  window.addEventListener("resize", fitTagline);

  /* ---------- tabs ---------------------------------------------------------- */
  const tabBtns = [].slice.call(document.querySelectorAll(".tab"));
  const inkBar = document.querySelector(".ink");
  function moveInk(b) {
    inkBar.style.width = b.offsetWidth + "px";
    inkBar.style.transform = "translateX(" + b.offsetLeft + "px)";
  }
  function goTab(b, quiet) {
    tabBtns.forEach(o => {
      const on = o === b;
      o.setAttribute("aria-selected", on ? "true" : "false");
      $("p-" + o.dataset.p).classList.toggle("on", on);
    });
    moveInk(b);
    if (!quiet) {
      if (b.scrollIntoView) b.scrollIntoView({ block: "nearest", inline: "nearest" });
      window.scrollTo(0, 0);
      if (history.replaceState) history.replaceState(null, "", "#" + b.dataset.p);
    }
  }
  function tabFromHash(quiet) {
    const want = (location.hash || "").replace("#", "");
    const b = tabBtns.find(o => o.dataset.p === want);
    if (b) goTab(b, quiet);
  }
  tabBtns.forEach((b, i) => {
    b.addEventListener("click", () => goTab(b));
    b.addEventListener("keydown", e => {
      const d = e.key === "ArrowRight" ? 1 : (e.key === "ArrowLeft" ? -1 : 0);
      if (!d) return;
      e.preventDefault();
      const t = tabBtns[(i + d + tabBtns.length) % tabBtns.length];
      t.focus(); goTab(t);
    });
  });
  document.addEventListener("keydown", e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const i = ["1", "2", "3", "4", "5"].indexOf(e.key);
    if (i >= 0) goTab(tabBtns[i]);
  });
  requestAnimationFrame(() => {
    inkBar.style.transition = "none";      /* first placement must not animate */
    moveInk(tabBtns[0]);
    tabFromHash(true);
    requestAnimationFrame(() => { inkBar.style.transition = ""; });
  });
  window.addEventListener("hashchange", () => tabFromHash(false));
  window.addEventListener("resize", () => {
    const cur = tabBtns.find(b => b.getAttribute("aria-selected") === "true");
    if (cur) moveInk(cur);
  });

  /* ---------- shared state -------------------------------------------------- */
  const S = { mk: null, wk: null, br: null, al: null, wstate: {} };
  const STCLS = { "Buy": "st-buy", "Hold": "st-hold", "Flat": "st-flat", "Wait": "st-wait", "Sell": "st-sell", "No read": "st-noread", "No data": "st-nodata" };

  /* ==========================================================================
     MARKETS
     ========================================================================== */
  const WINDOWS = [
    { k: "chg_24h", l: "24h" }, { k: "chg_7d", l: "7d" },
    { k: "chg_30d", l: "30d" }, { k: "chg_ytd", l: "YTD" }
  ];
  const GROUPS = ["Commodities", "Indices & macro", "Stocks", "Crypto", "Oil & gas majors"];
  const mkState = { group: "all", q: "", sort: null, dir: -1, win: "chg_24h" };
  let CAPS = {};

  /* the feed's groups, in the board's order, any unknown group appended */
  function groupList() {
    const present = {};
    S.mk.assets.forEach(a => { present[a.group] = true; });
    return GROUPS.filter(g => present[g]).concat(Object.keys(present).filter(g => GROUPS.indexOf(g) === -1));
  }

  function symOf(a) {
    const fromId = () => String(a.id).split("_")[0].replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 5);
    const s = a.source || "", i = s.indexOf(":");
    if (i < 0) return fromId();
    const prov = s.slice(0, i);
    if (prov === "computed" || prov === "coingecko") return fromId();
    const tok = s.slice(i + 1).split(/[\s;+]/)[0]
      .replace(/^\^/, "").replace(/-USD$/i, "").replace(/=F$/, "")
      .replace(/\.[A-Za-z]+$/, "").replace(/[^A-Za-z0-9]/g, "");
    return tok ? tok.toUpperCase().slice(0, 5) : fromId();
  }

  /* provenance notes for a row: what the feed says, plus what its own gaps mean */
  function rowNotes(a) {
    const m = [];
    if (a.as_of) m.push("as of " + a.as_of);
    if (a.basis_note) m.push(a.basis_note);
    if (a.currency && ["USD", "RATIO", "USD_BN"].indexOf(a.currency) === -1 && isNum(a.price_native)) {
      m.push("quoted " + a.price_native.toLocaleString("en-US", { maximumFractionDigits: 2 }) + " " + a.currency + " · shown in USD");
    }
    const nm = String(a.name || "");
    if (/copper/i.test(nm) && !isNum(a.chg_7d) && !isNum(a.chg_30d)) m.push("no free spot history — figures fill in as days accumulate");
    if (/spacex/i.test(nm) && !isNum(a.chg_ytd)) m.push("listed June 2026 — no year-start price to measure against");
    return m;
  }

  function renderTape() {
    const host = $("mk-tape");
    host.innerHTML = "";
    ["btc", "gold", "sp500", "wti", "dxy"].forEach(id => {
      const a = S.mk.assets.find(x => x.id === id);
      if (!a) return;
      const c = el("div", "tp");
      const r = el("div", "tp-r");
      r.appendChild(el("div", "tp-n", String(a.name).replace(/ \(.*\)/, "")));
      if (isNum(a.chg_24h)) r.appendChild(el("div", "tp-d " + dirOf(a.chg_24h), fmtPct(a.chg_24h)));
      else r.appendChild(el("div", "tp-d na", "24h N/A"));
      c.appendChild(r);
      c.appendChild(el("div", "tp-p", fmtPrice(a.price_usd, a.currency) || "N/A"));
      const x = el("div", "tp-x");
      [["7d", a.chg_7d], ["30d", a.chg_30d], ["YTD", a.chg_ytd]].forEach(p => {
        const s = el("span");
        s.appendChild(el("b", null, p[0]));
        s.appendChild(isNum(p[1]) ? el("span", dirOf(p[1]), fmtPct(p[1])) : el("span", "na", "N/A"));
        x.appendChild(s);
      });
      c.appendChild(x);
      host.appendChild(c);
    });
  }

  function renderBreadth() {
    const host = $("mk-breadth");
    host.innerHTML = "";
    const box = el("div", "breadth");
    const wlabel = WINDOWS.find(w => w.k === mkState.win).l;

    const left = el("div");
    const hd = el("div", "brh");
    hd.appendChild(el("div", "brt", "Breadth"));
    const wsel = el("div", "chips");
    WINDOWS.forEach(w => {
      const b = el("button", "chip sm", w.l);
      b.setAttribute("aria-pressed", mkState.win === w.k ? "true" : "false");
      b.addEventListener("click", () => { mkState.win = w.k; renderBreadth(); });
      wsel.appendChild(b);
    });
    hd.appendChild(wsel);
    left.appendChild(hd);

    const vals = S.mk.assets.map(a => a[mkState.win]).filter(isNum);
    const up = vals.filter(v => v > 0.005).length;
    const dn = vals.filter(v => v < -0.005).length;
    const fl = vals.length - up - dn;
    const na = S.mk.assets.length - vals.length;

    const bar = el("div", "brbar");
    [["g", up], ["f", fl], ["r", dn]].forEach(s => {
      if (!s[1]) return;
      const seg = el("div", "brseg " + s[0]);
      seg.style.flexGrow = s[1];
      bar.appendChild(seg);
    });
    left.appendChild(bar);

    const sorted = vals.slice().sort((x, y) => x - y);
    const med = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;

    const key = el("div", "brkey");
    function kv(col, n, label, dashed) {
      const s = el("span");
      const i = el("i");
      if (dashed) { i.style.border = "1px dashed var(--faint)"; } else { i.style.background = col; }
      s.appendChild(i);
      s.appendChild(el("b", null, String(n)));
      s.appendChild(document.createTextNode(" " + label));
      return s;
    }
    key.appendChild(kv("var(--up)", up, "advancing"));
    if (fl) key.appendChild(kv("var(--faint)", fl, "unchanged"));
    key.appendChild(kv("var(--dn)", dn, "declining"));
    if (na) key.appendChild(kv(null, na, "no figure", true));
    if (vals.length) {
      const m = el("span");
      m.appendChild(document.createTextNode("median "));
      m.appendChild(el("b", "num " + dirOf(med), fmtPct(med)));
      key.appendChild(m);
    }
    left.appendChild(key);
    box.appendChild(left);

    const right = el("div");
    const hd2 = el("div", "brh");
    hd2.appendChild(el("div", "brt", "Movers"));
    hd2.appendChild(el("span", null, "largest " + wlabel + " moves")).style.cssText = "font-size:11px;color:var(--faint)";
    right.appendChild(hd2);

    const live = S.mk.assets.filter(a => isNum(a[mkState.win])).slice().sort((x, y) => y[mkState.win] - x[mkState.win]);
    const mv = el("div", "movers");
    const cu = el("div", "mvc"), cd = el("div", "mvc");
    function row(a2, rank) {
      const r = el("div", "mv");
      r.appendChild(el("span", "r", rank));
      r.appendChild(el("span", "n", a2.name));
      r.appendChild(el("span", "v " + dirOf(a2[mkState.win]), fmtPct(a2[mkState.win])));
      return r;
    }
    live.slice(0, 3).forEach((a2, i) => cu.appendChild(row(a2, String(i + 1))));
    live.slice(-3).reverse().forEach((a2, i) => cd.appendChild(row(a2, String(i + 1))));
    mv.appendChild(cu); mv.appendChild(cd);
    right.appendChild(mv);
    box.appendChild(right);
    host.appendChild(box);
  }

  function renderControls() {
    const host = $("mk-controls");
    host.innerHTML = "";
    const chips = el("div", "chips");
    const counts = { all: S.mk.assets.length };
    const groups = groupList();
    groups.forEach(g => { counts[g] = S.mk.assets.filter(a => a.group === g).length; });
    [["all", "All"]].concat(groups.map(g => [g, g])).forEach(p => {
      const b = el("button", "chip");
      b.appendChild(document.createTextNode(p[1]));
      b.appendChild(el("span", "c", String(counts[p[0]])));
      b.setAttribute("aria-pressed", mkState.group === p[0] ? "true" : "false");
      b.addEventListener("click", () => { mkState.group = p[0]; renderControls(); renderTables(); });
      chips.appendChild(b);
    });
    host.appendChild(chips);

    const s = el("div", "search");
    s.appendChild(svgel('<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>'));
    const inp = document.createElement("input");
    inp.type = "search"; inp.placeholder = "Find an asset"; inp.value = mkState.q;
    inp.setAttribute("aria-label", "Filter assets by name");
    inp.addEventListener("input", () => { mkState.q = inp.value; renderTables(); });
    s.appendChild(inp);
    host.appendChild(s);
  }

  function visibleAssets() {
    const q = mkState.q.trim().toLowerCase();
    return S.mk.assets.filter(a => {
      if (mkState.group !== "all" && a.group !== mkState.group) return false;
      if (!q) return true;
      return (a.name + " " + a.id + " " + symOf(a) + " " + a.group).toLowerCase().indexOf(q) !== -1;
    });
  }

  /* one heat scale for the whole board, per column */
  function computeCaps() {
    const c = {};
    WINDOWS.forEach(w => {
      let m = 0;
      S.mk.assets.forEach(a => { if (isNum(a[w.k])) m = Math.max(m, Math.abs(a[w.k])); });
      c[w.k] = m;
    });
    return c;
  }

  /* the tint is a heat map: hue is direction, strength is the size of the move
     against the largest move in the same column, compressed so small moves stay
     visible beside triple-digit ones */
  function pctTd(v, label, cap) {
    const td = el("td", "pc");
    td.setAttribute("data-l", label);
    if (!isNum(v)) {
      td.appendChild(el("span", "v na", "N/A"));
      return td;
    }
    const dir = dirOf(v);
    if (cap > 0 && dir !== "flat") {
      const ratio = Math.min(1, Math.abs(v) / cap);
      const tint = el("span", "tint");
      const mix = (2 + 11 * Math.pow(ratio, 0.55)).toFixed(1);
      tint.style.background = "color-mix(in srgb, var(--" + dir + ") " + mix + "%, transparent)";
      td.appendChild(tint);
    }
    td.appendChild(el("span", "v " + dir, fmtPct(v)));
    return td;
  }

  function buildTable(rows) {
    const wrap = el("div", "twrap");
    const t = document.createElement("table");
    t.className = "mk";
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    const cols = [
      { l: "Asset", k: "name" }, { l: "Price", k: "price_usd" },
      { l: "24h", k: "chg_24h" }, { l: "7d", k: "chg_7d" },
      { l: "30d", k: "chg_30d" }, { l: "YTD", k: "chg_ytd" }
    ];
    cols.forEach(c => {
      const th = document.createElement("th");
      th.appendChild(document.createTextNode(c.l));
      th.className = "sortable"; th.tabIndex = 0; th.setAttribute("role", "button");
      th.appendChild(el("span", "arw", mkState.sort === c.k && mkState.dir === 1 ? "↑" : "↓"));
      if (mkState.sort === c.k) th.setAttribute("aria-sort", mkState.dir === 1 ? "ascending" : "descending");
      /* three states so the reader can always get back to the grouped view */
      const fire = () => {
        if (mkState.sort !== c.k) { mkState.sort = c.k; mkState.dir = c.k === "name" ? 1 : -1; }
        else if (mkState.dir === (c.k === "name" ? 1 : -1)) { mkState.dir = -mkState.dir; }
        else { mkState.sort = null; }
        renderTables();
      };
      th.addEventListener("click", fire);
      th.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fire(); } });
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    t.appendChild(thead);

    const tb = document.createElement("tbody");
    rows.forEach(a => {
      const r = document.createElement("tr");
      const td = el("td", "nm2");
      const box = el("div", "aname");
      const sym = symOf(a);
      const tick = el("div", "tick", sym);
      tick.style.fontSize = sym.length >= 5 ? "8px" : (sym.length === 4 ? "9px" : "10.5px");
      box.appendChild(tick);
      const n = el("div", "nm");
      const b = el("b");
      b.appendChild(document.createTextNode(a.name));
      if (S.wstate[a.id]) {
        const chip = el("button", "stmini " + (STCLS[S.wstate[a.id]] || "st-flat"), S.wstate[a.id]);
        chip.title = "Current Weekly Review read — open the forecast card";
        chip.addEventListener("click", e => { e.stopPropagation(); location.hash = "weekly"; });
        b.appendChild(chip);
      }
      n.appendChild(b);
      const meta = rowNotes(a);
      if (meta.length) n.appendChild(el("i", null, meta.join(" · ")));
      box.appendChild(n);
      td.appendChild(box);
      r.appendChild(td);

      const p = el("td", "price");
      const pv = fmtPrice(a.price_usd, a.currency);
      p.appendChild(pv === null ? el("span", "v na", "N/A") : el("span", "v", pv));
      r.appendChild(p);

      r.appendChild(pctTd(a.chg_24h, "24h", CAPS.chg_24h));
      r.appendChild(pctTd(a.chg_7d, "7d", CAPS.chg_7d));
      r.appendChild(pctTd(a.chg_30d, "30d", CAPS.chg_30d));
      r.appendChild(pctTd(a.chg_ytd, "YTD", CAPS.chg_ytd));
      tb.appendChild(r);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }

  function renderTables() {
    const host = $("mk-tables");
    host.innerHTML = "";
    let rows = visibleAssets();

    if (!rows.length) {
      host.appendChild(emptyBox("Nothing matches “" + mkState.q + "”", ["Try an asset name, a ticker, or a group."]));
      return;
    }

    const flat = mkState.sort !== null || mkState.group !== "all" || mkState.q.trim() !== "";
    if (mkState.sort) {
      const k = mkState.sort, dir = mkState.dir;
      rows = rows.slice().sort((x, y) => {
        const a = x[k], b = y[k];
        if (k === "name") return dir * String(a).localeCompare(String(b));
        const an = !isNum(a), bn = !isNum(b);
        if (an && bn) return 0;
        if (an) return 1;
        if (bn) return -1;
        return dir * (a - b);
      });
    }

    function grpBlock(title, list, tag) {
      const g = el("div", "grp");
      const head = el("div", "stitle");
      head.appendChild(el("h2", null, title));
      head.appendChild(el("span", "rule"));
      head.appendChild(el("span", "tag", tag));
      g.appendChild(head);
      g.appendChild(buildTable(list));
      return g;
    }

    if (flat) {
      const tag = rows.length + (rows.length === 1 ? " row" : " rows") +
        (mkState.sort ? " · sorted by " + (mkState.sort === "name" ? "name" : (mkState.sort === "price_usd" ? "price" : mkState.sort.replace("chg_", ""))) + " · click again to clear" : "");
      host.appendChild(grpBlock(mkState.group === "all" ? "All instruments" : mkState.group, rows, tag));
      return;
    }
    groupList().forEach(gn => {
      const subrows = rows.filter(a => a.group === gn);
      if (subrows.length) host.appendChild(grpBlock(gn, subrows, subrows.length + " rows"));
    });
  }

  function renderMarkets(doc) {
    S.mk = doc;
    const gen = new Date(doc.generated_utc);
    const groups = groupList();
    $("folio").textContent = dateGB(gen) + ", " + timeUTC(gen) + " UTC";
    $("k-markets").textContent = doc.assets.length;
    $("foot-meta").textContent = "board updated " + dateGB(gen) + ", " + timeUTC(gen) + " UTC";
    sub($("mk-sub"), [
      [doc.assets.length + " instruments across " + groups.length + " groups"],
      ["pulled hourly"],
      ["updated " + dateGB(gen) + " " + timeUTC(gen) + " UTC", true]
    ]);

    const vh = $("mk-vintage");
    vh.innerHTML = "";
    const ageHours = (Date.now() - gen.getTime()) / 3600000;
    if (ageHours > 36) {
      vh.appendChild(stale("These figures are " + Math.floor(ageHours / 24) +
        " day(s) old. The update job has not run — treat them as historical, not current."));
    }

    CAPS = computeCaps();
    renderTape();
    renderBreadth();
    renderControls();
    renderTables();
    hide("status");
  }

  function marketsFail(msg) {
    const s = $("status");
    s.hidden = false;
    s.textContent = msg;
    $("folio").textContent = "unavailable";
  }

  fetch("data/latest.json?t=" + Date.now(), { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(doc => {
      if (!doc || !doc.assets || !doc.assets.length) throw new Error("no assets in feed");
      renderMarkets(doc);
    })
    .catch(e => {
      marketsFail("Market data could not be loaded (" + e.message + "). Nothing is shown rather than showing stale numbers.");
    });

  /* ==========================================================================
     DAILY BRIEF
     ========================================================================== */
  function renderBrief(doc) {
    S.br = doc;
    const sections = doc.sections || [];
    const n = sections.reduce((t, s) => t + (s.items || []).length, 0);
    $("k-brief").textContent = n;
    sub($("br-sub"), [
      [dateLong(doc.date)],
      [(doc.lookback_days || 7) + "-day lookback"],
      [n + " items in " + sections.length + " sections"],
      ["every item answers: why should an investor care?"]
    ]);

    /* Same honesty rule as the price table: say when it is old. */
    const d = new Date(doc.date + "T12:00:00Z");
    const ageDays = Math.floor((Date.now() - d.getTime()) / 86400000);
    const sh = $("br-stale");
    sh.innerHTML = "";
    if (ageDays >= 2) {
      sh.appendChild(stale("This brief is " + ageDays +
        " days old. The daily update has not run — it describes that date, not today."));
    }

    /* the lead story is lifted out of its section and given the front page */
    const f = $("br-feature");
    f.innerHTML = "";
    const lead = (sections[0] && sections[0].items && sections[0].items[0]) || null;
    if (lead) {
      f.appendChild(el("div", "fk", "Lead story · " + sections[0].name));
      f.appendChild(el("h2", null, lead.headline));
      const w = el("div", "fw");
      w.appendChild(el("span", "lbl", "Why it matters"));
      w.appendChild(el("p", null, lead.why));
      f.appendChild(w);
      if (lead.sources && lead.sources.length) f.appendChild(srcRow(lead.sources));
      f.hidden = false;
    } else {
      f.hidden = true;
    }

    const toc = $("br-toc"), body = $("br-body");
    toc.innerHTML = ""; body.innerHTML = "";
    toc.appendChild(el("div", "toc-h", "In this brief"));

    sections.forEach((s, i) => {
      const items = (s.items || []).filter(it => it !== lead);
      const total = items.length + (lead && i === 0 ? 1 : 0);
      const slug = "bs-" + i;
      const a = document.createElement("a");
      a.href = "#" + slug; a.dataset.t = slug;
      a.addEventListener("click", e => {
        e.preventDefault();
        const t = document.getElementById(slug);
        if (t && t.scrollIntoView) t.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      a.appendChild(el("span", null, s.name));
      a.appendChild(el("span", "k", String(total)));
      toc.appendChild(a);

      const sec = el("section", "bsec");
      sec.id = slug;
      const hd = el("div", "bsec-h");
      hd.appendChild(el("div", "n", String(i + 1)));
      hd.appendChild(el("h2", null, s.name));
      hd.appendChild(el("span", "rule"));
      hd.appendChild(el("span", "ct", total + (total === 1 ? " item" : " items") + (lead && i === 0 ? " · lead above" : "")));
      sec.appendChild(hd);

      if (!total) sec.appendChild(el("p", "bnone", "Nothing notable this week."));
      items.forEach(it => {
        const art = el("article", "bitem");
        art.appendChild(el("h3", null, it.headline));
        const why = el("div", "bwhy");
        const wp = el("div");
        wp.appendChild(el("span", "lbl", "Why it matters"));
        wp.appendChild(el("p", null, it.why));
        why.appendChild(wp);
        art.appendChild(why);
        if (it.sources && it.sources.length) art.appendChild(srcRow(it.sources));
        sec.appendChild(art);
      });
      body.appendChild(sec);
    });

    const links = [].slice.call(toc.querySelectorAll("a"));
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(es => {
        es.forEach(e => {
          if (!e.isIntersecting) return;
          links.forEach(l => l.classList.toggle("cur", l.dataset.t === e.target.id));
        });
      }, { rootMargin: "-90px 0px -70% 0px", threshold: 0 });
      body.querySelectorAll(".bsec").forEach(s => io.observe(s));
    }
    if (links[0]) links[0].classList.add("cur");

    show("br-main");
    hide("briefstatus");
  }

  function briefEmpty(msg) {
    const host = $("br-empty");
    host.innerHTML = "";
    host.appendChild(emptyBox("The daily brief isn't running yet", [
      "This tab will carry a written market brief — tech, crypto, macro and geopolitics, " +
      "commodities, and technical levels — generated once a day and filtered down to what actually moved."
    ], msg || "Nothing is shown here rather than showing something unverified."));
    hide("br-main");
    hide("briefstatus");
  }

  fetch("data/brief/latest.json?t=" + Date.now(), { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error("no brief yet"); return r.json(); })
    .then(doc => {
      if (!doc || !doc.sections || !doc.sections.length) throw new Error("empty brief");
      renderBrief(doc);
    })
    .catch(() => { briefEmpty(); });

  /* ==========================================================================
     WEEKLY REVIEW
     ========================================================================== */
  const STATE_LEGEND = [
    ["Buy", "At or near a bottom, or expected to rise significantly."],
    ["Hold", "In an uptrend, expected to continue. The easy entry has passed."],
    ["Flat", "Sideways inside a stated range. No trend to join either way."],
    ["Wait", "Falling, no base formed. Not a buy yet — the mirror of Hold."],
    ["Sell", "At or near a top, or expected to drop significantly."],
    ["No read", "Market not legible — a dated tier-one event falls in the window. No forecast."],
    ["No data", "Feed broken or stale. Nothing analysed because there was nothing to analyse."]
  ];
  function stChip(s) { return el("span", "st " + (STCLS[s] || "st-flat"), s); }

  function recCell(label, value, subtext, opts) {
    const c = el("div", "rc" + (opts && opts.hl ? " hl" : ""));
    c.appendChild(el("div", "l", label));
    c.appendChild(el("div", "v" + (opts && opts.pending ? " pend" : ""), value));
    if (subtext) c.appendChild(el("div", "s", subtext));
    return c;
  }

  /* PRICE SENSITIVITY AND TIME EXPIRY ARE TWO DIFFERENT CLAIMS.
     The stance maths returns the CURRENT price as the flip level whenever
     appending an unchanged close already moves the stance into another bucket
     - momentum decay, with no price move involved at all. The page used to
     print that as "flips at $X" beside "price $X", which reads as a
     hair-trigger when what it means is that the read expires at the next
     close. So the two are reported separately, always, and this predicate
     picks out the case where there is no price level to report.
     Exact equality, deliberately - not a tolerance and not a percentage
     threshold. The flip level and the price come out of the same rounding in
     the same generator, so when the maths means "no move required" the two
     numbers are identical, and when it means a real level they are not. */
  function flipIsTimeOnly(a) {
    const st = a && a.stance;
    if (!st || !isNum(st.flip_level)) return false;
    const f = a.forecast || {};
    const base = (f.next_week && isNum(f.next_week.base)) ? f.next_week.base : a.price;
    return isNum(base) && st.flip_level === base;
  }

  function fanChart(a) {
    const f = a.forecast || {};
    const e = f.eoy || null;
    const bands = [];
    if (f.next_week && isNum(f.next_week.lo) && isNum(f.next_week.hi)) {
      bands.push(["Next week", isNum(f.next_week.coverage) ? Math.round(f.next_week.coverage * 100) + "%" : "", f.next_week.lo, f.next_week.hi, "b1"]);
    }
    if (f.next_month && isNum(f.next_month.lo) && isNum(f.next_month.hi)) {
      bands.push(["Next month", isNum(f.next_month.coverage) ? Math.round(f.next_month.coverage * 100) + "%" : "", f.next_month.lo, f.next_month.hi, "b2"]);
    }
    if (e && e.central && isNum(e.central.lo) && isNum(e.central.hi)) {
      bands.push(["Year-end", isNum(e.central.prob) ? Math.round(e.central.prob * 100) + "%" : "", e.central.lo, e.central.hi, "b3"]);
    }
    if (e) {
      const env = e.envelope_80 || (isNum(e.lo) && isNum(e.hi) ? { lo: e.lo, hi: e.hi } : null);
      if (env && isNum(env.lo) && isNum(env.hi)) bands.push(["Year-end", "80%", env.lo, env.hi, "b4"]);
    }
    if (!bands.length) return null;

    const base = (f.next_week && isNum(f.next_week.base)) ? f.next_week.base :
      ((f.next_month && isNum(f.next_month.base)) ? f.next_month.base : a.price);
    /* Suppressed when the level IS the price: a marker sitting exactly on
       "now" is the same conflation drawn instead of written. */
    const flip = (a.stance && isNum(a.stance.flip_level) && !flipIsTimeOnly(a))
      ? a.stance.flip_level : null;
    const timeOnly = flipIsTimeOnly(a);
    const marks = [];
    bands.forEach(b => { marks.push(b[2], b[3]); });
    if (isNum(base)) marks.push(base);
    if (flip !== null) marks.push(flip);
    let lo = Math.min.apply(null, marks), hi = Math.max.apply(null, marks);
    const pad = (hi - lo) * 0.04 || 1; lo -= pad; hi += pad;
    const X = v => ((v - lo) / (hi - lo)) * 100;

    const box = el("div", "fan");
    const hd = el("div", "fan-h");
    hd.appendChild(el("div", "t", "Forecast ranges"));
    hd.appendChild(el("div", "s", "frozen before the period they cover"));
    box.appendChild(hd);

    const rows = el("div", "fanrows");
    bands.forEach(b => {
      const r = el("div", "fanrow");
      const fl = el("div", "fl");
      fl.appendChild(document.createTextNode(b[0]));
      if (b[1]) fl.appendChild(el("span", "cov", b[1]));
      r.appendChild(fl);
      const tr = el("div", "ftrack");
      const bd = el("div", "fband " + b[4]);
      bd.style.left = X(b[2]).toFixed(2) + "%";
      bd.style.width = Math.max(0.8, X(b[3]) - X(b[2])).toFixed(2) + "%";
      tr.appendChild(bd);
      if (flip !== null) {
        const fp = el("div", "fflip");
        fp.style.left = X(flip).toFixed(2) + "%";
        tr.appendChild(fp);
      }
      if (isNum(base)) {
        const nw = el("div", "fnow");
        nw.style.left = X(base).toFixed(2) + "%";
        tr.appendChild(nw);
      }
      r.appendChild(tr);
      r.appendChild(el("div", "fv", fmtLevel(b[2]) + " – " + fmtLevel(b[3])));
      rows.appendChild(r);
    });
    box.appendChild(rows);

    const lg = el("div", "fleg");
    if (isNum(base)) {
      const l1 = el("span");
      l1.appendChild(el("i", "ln"));
      l1.appendChild(document.createTextNode(" now " + fmtLevel(base) + " (no-change base)"));
      lg.appendChild(l1);
    }
    if (flip !== null) {
      const l2 = el("span");
      l2.appendChild(el("i", "lf"));
      l2.appendChild(document.createTextNode(" turns to " + (a.stance.flip_to || "?") + " at " + fmtLevel(flip)));
      lg.appendChild(l2);
    } else if (timeOnly) {
      lg.appendChild(el("span", null,
        "the read turns to " + ((a.stance && a.stance.flip_to) || "?") +
        " at the next close - no price level"));
    }
    const dates = [];
    if (f.next_week && f.next_week.target_date) dates.push("week to " + f.next_week.target_date);
    if (f.next_month && f.next_month.target_date) dates.push("month to " + f.next_month.target_date);
    if (dates.length) lg.appendChild(el("span", null, dates.join(" · ")));
    if (e) {
      const up = e.upside && isNum(e.upside.above) ? " · upside 25% above " + fmtLevel(e.upside.above) : "";
      const dn = e.downside && isNum(e.downside.below) ? " · downside 25% below " + fmtLevel(e.downside.below) : "";
      lg.appendChild(el("span", null, "year-end is scenarios, not a forecast — excluded from the accuracy record" + up + dn));
    }
    box.appendChild(lg);
    return box;
  }

  function trendBars(sig) {
    const tc = sig && sig.trend_components;
    if (!tc) return null;
    const keys = ["21", "63", "126", "252"].filter(k => isNum(tc[k]));
    if (!keys.length) return null;
    const wrap = el("div", "mini");
    wrap.appendChild(el("span", "l", "Trend"));
    const bars = el("div", "tbars");
    bars.title = "trend components, shortest to longest: " +
      keys.map(k => k + "d " + tc[k].toFixed(2)).join(" · ") + " (standard deviations)";
    keys.forEach(k => {
      const z = tc[k];
      const b = el("div", "tb " + (z >= 0 ? "p" : "n"));
      const mag = Math.min(1, Math.abs(z) / 2.2);
      const i = el("i");
      const hh = Math.max(3, mag * 11);
      if (z >= 0) { i.style.bottom = "12px"; i.style.height = hh.toFixed(1) + "px"; }
      else { i.style.top = "12px"; i.style.height = hh.toFixed(1) + "px"; }
      b.appendChild(i);
      bars.appendChild(b);
    });
    wrap.appendChild(bars);
    return wrap;
  }

  function rangePos(sig) {
    if (!sig || !isNum(sig.range_pos_252d)) return null;
    const wrap = el("div", "mini");
    wrap.appendChild(el("span", "l", "1y range"));
    const t = el("div", "rng");
    t.title = "sits at the " + Math.round(sig.range_pos_252d * 100) + "th percentile of its one-year range";
    const u = document.createElement("u");
    u.style.left = (Math.max(0, Math.min(1, sig.range_pos_252d)) * 100).toFixed(1) + "%";
    t.appendChild(u);
    wrap.appendChild(t);
    wrap.appendChild(el("span", "num", Math.round(sig.range_pos_252d * 100) + "%"));
    return wrap;
  }

  function confMeter(st) {
    if (!st || !isNum(st.confidence)) return null;
    const wrap = el("div", "conf");
    wrap.appendChild(el("span", "l", "Conf"));
    const b = el("div", "confb");
    b.title = st.confidence_meaning || "historical probability that this stance's one-week claim holds";
    const i = document.createElement("i");
    i.style.width = (Math.max(0, Math.min(1, st.confidence)) * 100).toFixed(0) + "%";
    b.appendChild(i);
    wrap.appendChild(b);
    wrap.appendChild(el("span", "cv num", Math.round(st.confidence * 100) + "%"));
    return wrap;
  }

  function wordsBlock(a) {
    const w = a.words || {};
    const panes = [];
    if (w.technical) panes.push(["Technical", p => p.appendChild(el("p", null, w.technical))]);
    if (w.macro) panes.push(["Macro", p => p.appendChild(el("p", null, w.macro))]);
    if (w.eoy_scenarios) panes.push(["Year-end", p => {
      [["central", "c", "Central"], ["upside", "u", "Upside"], ["downside", "d", "Downside"]].forEach(k => {
        if (!w.eoy_scenarios[k[0]]) return;
        const s = el("p", "scen " + k[1]);
        s.appendChild(el("b", null, k[2]));
        s.appendChild(document.createTextNode(w.eoy_scenarios[k[0]]));
        p.appendChild(s);
      });
    }]);
    if (w.long_term) panes.push(["Long term", p => p.appendChild(el("p", null, w.long_term))]);
    if (w.note) panes.push(["Note", p => p.appendChild(el("p", null, w.note))]);
    if (w.citations && w.citations.length) panes.push(["Sources", p => p.appendChild(srcRow(w.citations))]);
    if (!panes.length) return null;

    const box = el("div", "words");
    const tabs = el("div", "wtabs");
    tabs.setAttribute("role", "tablist");
    const body = el("div", "wbody");
    const els = [];
    panes.forEach((pn, i) => {
      const b = el("button", "wtab", pn[0]);
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", i === 0 ? "true" : "false");
      const p = el("div", "wpane" + (i === 0 ? " on" : ""));
      pn[1](p);
      tabs.appendChild(b); body.appendChild(p);
      els.push([b, p]);
      b.addEventListener("click", () => {
        els.forEach(e2 => {
          const on = e2[0] === b;
          e2[0].setAttribute("aria-selected", on ? "true" : "false");
          e2[1].classList.toggle("on", on);
        });
      });
    });
    box.appendChild(tabs); box.appendChild(body);
    return box;
  }

  function lastWeekText(lw) {
    if (!lw) return "First review for this asset — no prior call to score.";
    return "Last week: " + (lw.stance || "—") +
      (lw.stance_hit === true ? " · hit" : (lw.stance_hit === false ? " · miss" : "")) +
      (lw.range_hit === true ? " · inside range" : (lw.range_hit === false ? " · outside range" : "")) +
      (isNum(lw.realized_pct) ? " · moved " + fmtPct(lw.realized_pct) : "");
  }

  function weeklyCard(a) {
    const c = el("article", "ac");
    const hd = el("div", "ac-h");

    const r1 = el("div", "ac-r1");
    const nm = el("div", "ac-nm");
    nm.appendChild(el("b", null, a.name));
    const srcTok = (a.source || "").replace(/^[a-z-]+:/, "").split(" ")[0];
    const metaBits = [];
    if (srcTok) metaBits.push(srcTok);
    if (a.price_date) metaBits.push("last close " + a.price_date);
    if (metaBits.length) nm.appendChild(el("i", null, metaBits.join(" · ")));
    r1.appendChild(nm);
    const px = el("div", "ac-px");
    if (isNum(a.price)) px.appendChild(el("span", "p", fmtLevel(a.price)));
    if (isNum(a.week_change_pct)) px.appendChild(el("span", "w " + dirOf(a.week_change_pct), fmtPct(a.week_change_pct) + " wk"));
    r1.appendChild(px);
    hd.appendChild(r1);

    const strip = el("div", "ac-strip");
    strip.appendChild(stChip(a.state));
    const tb = trendBars(a.signals); if (tb) strip.appendChild(tb);
    const rp = rangePos(a.signals); if (rp) strip.appendChild(rp);
    const cm = a.stance ? confMeter(a.stance) : null; if (cm) strip.appendChild(cm);
    hd.appendChild(strip);
    c.appendChild(hd);

    if (a.state === "No data") {
      c.appendChild(el("p", "acnote",
        "No data: " + (a.reason || "feed unavailable") + " Nothing is analysed, " +
        "nothing is scored, and this does not spend the weekly decline allowance."));
    } else if (a.state === "No read") {
      const nr = a.no_read || {};
      c.appendChild(el("p", "acnote",
        "No read: " + (nr.name || "a tier-one event") + " falls inside the forecast " +
        "window (" + (nr.date || "") + "). No forecast is made; this is counted on " +
        "the record as a decline."));
    } else if (a.forecast) {
      const fan = fanChart(a);
      if (fan) c.appendChild(fan);
      if (a.stance && isNum(a.stance.flip_level)) {
        /* Two statements, never one. What a price move would do, and what the
           passage of time will do, are separate facts about this read. */
        const to = a.stance.flip_to || "?";
        const timeOnly = flipIsTimeOnly(a);
        const fl = el("div", "flip");

        const r1 = el("div", "flr");
        r1.appendChild(el("i", null, "Price"));
        if (timeOnly) {
          r1.appendChild(document.createTextNode(
            "no move is required, and there is no level to watch. This read " +
            "changes to " + to + " whether the price rises, falls or stands still."));
        } else {
          /* the level can sit either side of the price: say which way it fires */
          const above = isNum(a.price) ? a.stance.flip_level > a.price : false;
          r1.appendChild(document.createTextNode("the read holds while the price stays " +
            (above ? "below " : "above ")));
          r1.appendChild(el("b", null, fmtLevel(a.stance.flip_level)));
          r1.appendChild(document.createTextNode("; a " + (above ? "rise" : "fall") +
            " through that level turns it to " + to + "."));
        }
        fl.appendChild(r1);

        const r2 = el("div", "flr");
        r2.appendChild(el("i", null, "Time"));
        r2.appendChild(document.createTextNode(timeOnly
          ? "this read expires at the next close. The stance is cut from rolling " +
            "lookback windows, and adding one more observation shifts them even " +
            "when the price has not moved."
          : "this read is re-derived at every close. An unchanged price carries it " +
            "through the next one, but the lookback windows it is cut from move on " +
            "regardless, so the level above is not a standing trigger."));
        fl.appendChild(r2);

        if (isNum(a.stance.confidence)) {
          fl.appendChild(el("div", "flc", "Confidence " +
            Math.round(a.stance.confidence * 100) +
            "% is the historical probability that this one-week claim holds."));
        }
        c.appendChild(fl);
      }
    }

    const wb = wordsBlock(a);
    if (wb) c.appendChild(wb);

    /* Stored reviews are never edited, so a review published before this note
       existed carries no note field. Derive it from the record's own source
       rather than leaving the reader to wonder why the Markets tab quotes a
       different number for the same metal. */
    let basis = a.price_basis_note;
    if (!basis && (a.source || "").indexOf("lbma:") === 0) {
      basis = "level is the LBMA benchmark fix, one official print a day; " +
        "the Markets tab quotes live spot, which sits a little either side of it";
    }
    const provBits = [];
    if (a.source) provBits.push("source " + a.source);
    if (basis) provBits.push(basis);
    if (provBits.length) c.appendChild(el("div", "prov", provBits.join(" · ")));

    const lw2 = el("div", "lastwk");
    lw2.appendChild(svgel('<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>'));
    lw2.appendChild(document.createTextNode(lastWeekText(a.last_week)));
    c.appendChild(lw2);
    return c;
  }

  function renderWeekly(doc) {
    S.wk = doc;
    const fri = doc.review_friday || "";
    $("k-weekly").textContent = doc.assets.length;
    sub($("wk-sub"), [
      [doc.week || "", true],
      fri ? ["week ending " + fri] : null,
      doc.forecast_week ? ["forecasting " + doc.forecast_week] : null,
      doc.published_utc ? ["published " + String(doc.published_utc).slice(0, 10)] : null,
      ["next review Saturday morning (GMT+3)"]
    ]);

    const nh = $("wk-notice");
    nh.innerHTML = "";
    if (doc.vintage && doc.vintage.note) {
      nh.appendChild(notice(doc.vintage.note + " — data as of " + doc.vintage.asof + ".", "Note."));
    }
    /* honesty banner when a newer week has completed and no review covers it */
    if (fri) {
      const age = Math.floor((Date.now() - new Date(fri + "T23:59:59Z").getTime()) / 86400000);
      if (age > 9) {
        nh.appendChild(stale("This review covers the week ending " + fri + " — " + age +
          " days ago. A newer week has completed without a review."));
      }
    }

    const lh = $("wk-lede");
    lh.innerHTML = "";
    if (doc.week_summary) {
      const lw = el("div", "lede");
      lw.appendChild(el("div", "ledemark", "“"));
      const col = el("div");
      col.appendChild(el("div", "eyebrow", "The week in one paragraph"));
      col.appendChild(el("p", null, doc.week_summary));
      lw.appendChild(col);
      lh.appendChild(lw);
    }

    const sc = doc.scorecard || {}, wk = sc.weekly || {}, r12 = sc.rolling_12w || {};
    const called = doc.assets.filter(a => a.forecast && a.stance).length;
    const rec = $("wk-record");
    rec.innerHTML = "";
    rec.appendChild(recCell("This week", called + " called",
      (doc.declines ? doc.declines.no_read + " declined · " + doc.declines.no_data + " no data" : ""), { hl: true }));
    const r12d = r12.directional || {}, wkd = wk.directional || {}, rng = wk.range_1w || {};
    rec.appendChild(recCell("Rolling 12w",
      r12d.n ? Math.round(r12d.rate * 100) + "%" : "—",
      r12d.n ? r12d.hit + "/" + r12d.n + " directional calls" : "record starts this week",
      { pending: !r12d.n }));
    rec.appendChild(recCell("All time",
      wkd.n ? Math.round(wkd.rate * 100) + "%" : "—",
      wkd.n ? wkd.hit + "/" + wkd.n + " directional calls" : "record starts this week",
      { pending: !wkd.n }));
    rec.appendChild(recCell("Range coverage",
      rng.n ? Math.round(rng.coverage * 100) + "%" : "—",
      rng.n ? rng.hit + "/" + rng.n + " weekly ranges (target 80%)" : "target 80%",
      { pending: !rng.n }));
    rec.appendChild(recCell("Avg range width",
      wk.avg_width_pct != null ? wk.avg_width_pct.toFixed(1) + "%" : "—",
      "published weekly ranges", { pending: wk.avg_width_pct == null }));
    rec.appendChild(recCell("Best / worst read",
      wk.best_read ? wk.best_read.asset + " " + wk.best_read.stance : "—",
      wk.worst_read ? "worst: " + wk.worst_read.asset + " " + wk.worst_read.stance : "no scored calls yet",
      { pending: !wk.best_read }));

    const cfh = $("wk-calflag");
    cfh.innerHTML = "";
    if (doc.calibration && doc.calibration.flag) {
      const cf = el("div", "calflag");
      cf.appendChild(el("b", null, doc.calibration.flag));
      const bits = ["Range calibration is pooled across all published forecasts; n = " +
        (doc.calibration.pooled ? doc.calibration.pooled.n : 0) + "."];
      if (isNum(doc.nominal_coverage)) bits.push("Nominal coverage " + Math.round(doc.nominal_coverage * 100) + "%" +
        (doc.params_version ? ", parameters v" + doc.params_version : "") + ".");
      cf.appendChild(document.createTextNode(bits.join(" ")));
      cfh.appendChild(cf);
    }

    const firstF = doc.assets.find(a => a.forecast && a.forecast.next_week && a.forecast.next_week.target_date);
    $("wk-astag").textContent = doc.assets.length + " forecasts" + (firstF ? " · week to " + firstF.forecast.next_week.target_date : "");

    const host = $("wk-cards");
    host.innerHTML = "";
    doc.assets.forEach(a => host.appendChild(weeklyCard(a)));

    const coh = $("wk-coh");
    coh.innerHTML = "";
    if (doc.coherence && doc.coherence.note) {
      const p = el("p", "cohnote");
      p.appendChild(el("b", null, "Cross-asset note: "));
      p.appendChild(document.createTextNode(doc.coherence.note));
      coh.appendChild(p);
    }

    const leg = $("wk-legend");
    leg.innerHTML = "";
    STATE_LEGEND.forEach(p => {
      const r = el("div", "legrow");
      const l = el("div"); l.appendChild(stChip(p[0]));
      r.appendChild(l);
      r.appendChild(el("span", "t", p[1]));
      leg.appendChild(r);
    });

    show("wk-main");
    hide("weeklystatus");

    /* echo the current read onto the Markets board (weekly ids -> markets ids) */
    const map = { gold: "gold", silver: "silver", wti: "wti", btc: "btc", spx: "sp500", ndx: "ndx", dxy: "dxy" };
    S.wstate = {};
    doc.assets.forEach(a => { if (map[a.id] && a.state) S.wstate[map[a.id]] = a.state; });
    if (S.mk) renderTables();
  }

  /* The next Saturday, computed rather than written down, so this line cannot
     quietly go stale the way a hardcoded date would. */
  function nextSaturday() {
    const d = new Date();
    d.setDate(d.getDate() + ((6 - d.getDay()) + 7) % 7);
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  function weeklyEmpty(msg) {
    const host = $("wk-empty");
    host.innerHTML = "";
    host.appendChild(emptyBox("The first weekly review publishes " + nextSaturday(), [
      "This tab will carry a weekly market review of seven instruments — a technical and macro read, " +
      "calibrated forecast ranges, a stance with its flip level, and a running accuracy record scored by script.",
      "Reviews are published on Saturdays, after the US Friday close has settled. Each one is written before " +
      "the week it forecasts and scored afterwards by script, so the accuracy record can only be read forwards."
    ], msg || "Nothing is shown here until then, rather than showing something unverified."));
    hide("wk-main");
    hide("weeklystatus");
  }

  fetch("data/weekly/latest.json?t=" + Date.now(), { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error("no review yet"); return r.json(); })
    .then(doc => {
      if (!doc || !doc.assets) throw new Error("no review yet");
      /* An empty review is a STATE, not a broken document. Saying so here keeps
         the honest-empty path away from the malformed-document path, so a real
         malformation still stands out instead of looking like a quiet Saturday. */
      if (doc.assets.length === 0) { weeklyEmpty(doc.note); return; }
      if (doc.assets.length !== 7) throw new Error("malformed review");
      renderWeekly(doc);
    })
    .catch(() => { weeklyEmpty(); });

  /* ==========================================================================
     ALPHA HUNT
     Tab 4 is judgment where tab 3 is arithmetic, and it never borrows tab 3's
     calibrated vocabulary. The record is counts, never rates: no percentage
     appears anywhere on this tab, by design.
     ========================================================================== */
  const ALCLS = { "Valid": "al-valid", "Stronger": "al-stronger", "Weaker": "al-weaker", "Dead — killed": "al-killed", "Dead — arrived": "al-arrived" };
  const AL_LEGEND = [
    ["Valid", "The disagreement stands. The kill condition has not fired; mainstream has not moved."],
    ["Stronger", "New evidence supports it, or the consensus has started moving toward it. Cited."],
    ["Weaker", "Contrary evidence has appeared — a missed checkpoint, a contradicting source — but the one kill condition has not fired. Cited."],
    ["Dead — killed", "The kill condition written at birth fired. The idea was wrong, the record says so, and a post-mortem says what the hunt learned."],
    ["Dead — arrived", "Mainstream caught up: the arrival marker was met. This is the win the tab exists for, counted with how many weeks early the idea was."]
  ];
  function alChip(s) { return el("span", "al " + (ALCLS[s] || "al-valid"), s); }

  function killText(k) {
    if (!k || typeof k !== "object") return "";
    if (k.type === "price_level") {
      return "Price " + k.direction + " " + fmtLevel(k.level) + (k.note ? " — " + k.note : "");
    }
    if (k.type === "dated_event") return "By " + k.date + ": " + k.condition;
    if (k.type === "published_figure") {
      return k.body + " publishes " + k.metric + " " + k.comparator + " " + fmtLevel(k.threshold);
    }
    return "";
  }

  function alphaCard(c) {
    const card = el("article", "ac alc" +
      (c.status === "Dead — killed" ? " al-card-killed" : (c.status === "Dead — arrived" ? " al-card-arrived" : "")));
    const hd = el("div", "ac-h");
    const r1 = el("div", "ac-r1");
    const nm = el("div", "ac-nm");
    nm.appendChild(el("b", null, c.subject));
    const bits = [];
    if (c.ticker) bits.push(c.ticker);
    if (c.opened) bits.push("opened " + c.opened);
    if (bits.length) nm.appendChild(el("i", null, bits.join(" · ")));
    r1.appendChild(nm);
    const side = el("div", "ac-px");
    side.appendChild(alChip(c.status));
    if (c.status === "Dead — arrived" && isNum(c.weeks_early)) {
      side.appendChild(el("span", "early", c.weeks_early + " weeks early"));
    }
    r1.appendChild(side);
    hd.appendChild(r1);
    card.appendChild(hd);

    const body = el("div", "albody");

    body.appendChild(el("h4", null, "The consensus it disagrees with"));
    const cons = c.consensus || {};
    body.appendChild(el("p", "alq", cons.text || ""));
    if (cons.source && cons.source.url) body.appendChild(srcRow([cons.source]));

    body.appendChild(el("h4", null, "The disagreement"));
    body.appendChild(el("p", null, c.variant || ""));

    body.appendChild(el("h4", null, "The one way to be wrong"));
    body.appendChild(el("p", "alkill", killText(c.kill)));

    if (c.checkpoints && c.checkpoints.length) {
      body.appendChild(el("h4", null, "Checkpoints — expected, dated, sourced"));
      c.checkpoints.forEach(cp => {
        const row = el("div", "cprow");
        row.appendChild(el("span", "cpdate", cp.date));
        row.appendChild(cp.source ? extLink(cp.expect, cp.source, "cplink") : el("span", "cplink", cp.expect));
        body.appendChild(row);
      });
    }

    body.appendChild(el("h4", null, "What arrival would look like"));
    body.appendChild(el("p", null, c.arrival || ""));

    if (c.trail && c.trail.length) {
      body.appendChild(el("h4", null, "The trail — every review, append-only"));
      c.trail.forEach(t => {
        const row = el("div", "trailrow");
        row.appendChild(el("span", "trailweek", t.week));
        row.appendChild(alChip(t.status));
        const why = el("span", "trailwhy");
        why.appendChild(document.createTextNode((t.why || "") + " "));
        (t.sources || []).forEach(s => {
          if (!s || !s.url) return;
          why.appendChild(extLink(s.title || "source", s.url, "traillink"));
          why.appendChild(document.createTextNode(" "));
        });
        row.appendChild(why);
        body.appendChild(row);
      });
    }

    if (c.post_mortem) {
      const pm = el("div", "pm");
      pm.appendChild(el("h4", null, "Post-mortem — about the hunt, not the market"));
      [["Which assumption broke", c.post_mortem.assumption_broke],
       ["What would have caught it earlier", c.post_mortem.earlier_catch],
       ["The rule the hunt adopts", c.post_mortem.rule]
      ].forEach(pair => {
        const p = el("p", "pmrow");
        p.appendChild(el("b", null, pair[0] + ": "));
        p.appendChild(document.createTextNode(pair[1] || ""));
        pm.appendChild(p);
      });
      body.appendChild(pm);
    }

    if (c.sources && c.sources.length) {
      body.appendChild(el("h4", null, "Sources"));
      body.appendChild(srcRow(c.sources));
    }

    card.appendChild(body);
    return card;
  }

  function alSection(host, title, calls) {
    if (!calls.length) return;
    const sec = el("section", "alsec");
    const head = el("div", "stitle");
    head.appendChild(el("h2", null, title));
    head.appendChild(el("span", "rule"));
    head.appendChild(el("span", "tag", calls.length + (calls.length === 1 ? " call" : " calls")));
    sec.appendChild(head);
    const grid = el("div", "alcards");
    calls.forEach(c => grid.appendChild(alphaCard(c)));
    sec.appendChild(grid);
    host.appendChild(sec);
  }

  function renderAlpha(doc) {
    S.al = doc;
    const calls = doc.calls || [];
    $("k-alpha").textContent = calls.length;
    sub($("al-sub"), [
      [doc.week || "", true],
      doc.review_friday ? ["week ending " + doc.review_friday] : null,
      doc.published_utc ? ["published " + String(doc.published_utc).slice(0, 10)] : null,
      ["next hunt Saturday morning (GMT+3)"]
    ]);

    /* honesty banner when a newer week has completed and no hunt covers it */
    const sh = $("al-stale");
    sh.innerHTML = "";
    if (doc.review_friday) {
      const age = Math.floor((Date.now() - new Date(doc.review_friday + "T23:59:59Z").getTime()) / 86400000);
      if (age > 9) {
        sh.appendChild(stale("This record was last reviewed for the week ending " + doc.review_friday +
          " — " + age + " days ago. A newer week has completed without a hunt."));
      }
    }

    /* the count block — counts, never rates */
    const ct = doc.counts || {}, arr = ct.arrivals || [];
    const host = $("al-ledger");
    host.innerHTML = "";
    function lgc(label, v, s2, lead) {
      const c = el("div", "lg" + (lead ? " lead" : ""));
      c.appendChild(el("div", "l", label));
      c.appendChild(el("div", "v" + (v === 0 ? " zero" : ""), String(v)));
      c.appendChild(el("div", "s", s2));
      return c;
    }
    host.appendChild(lgc("Weeks hunted", ct.weeks_hunted || 0, "every Saturday counts, including the empty ones", true));
    host.appendChild(lgc("Weeks with a new call", ct.weeks_with_call || 0, "a small number is discipline, not failure"));
    host.appendChild(lgc("Calls live", ct.live || 0, "each carries one written way to be wrong"));
    host.appendChild(lgc("Dead — killed", ct.dead_killed || 0, "the kill condition fired; post-mortem published"));
    host.appendChild(lgc("Dead — arrived", ct.dead_arrived || 0, arr.length
      ? arr.map(a => a.subject + ": " + a.weeks_early + " weeks early").join(" · ")
      : "the win this tab exists for: mainstream catches up"));

    /* this week, in words */
    const sth = $("al-statement");
    sth.innerHTML = "";
    const st = el("div", "statement");
    st.appendChild(el("div", "sk", (doc.week || "") + (doc.review_friday ? " · week ending " + doc.review_friday : "")));
    st.appendChild(el("h2", null, doc.new_call_id ? "This week opened a new call: " + doc.new_call_id + "." : "No new alpha this week."));
    st.appendChild(el("p", null, doc.no_new_call_note ||
      "A call is opened only when the market genuinely seems to believe a wrong thing, and that is rare. An empty week is the bar holding, and it is counted above."));
    sth.appendChild(st);

    const live = calls.filter(c => ["Valid", "Stronger", "Weaker"].indexOf(c.status) !== -1);
    const dead = calls.filter(c => c.status === "Dead — killed" || c.status === "Dead — arrived");
    const eh = $("al-empty"), ch = $("al-calls");
    eh.innerHTML = ""; ch.innerHTML = "";
    if (!calls.length) {
      const e = el("div", "empty");
      const g = el("div", "glyph");
      g.appendChild(svgel('<svg viewBox="0 0 24 24"><path d="M4 5h16v4H4zM4 13h16v6H4z"/><path d="M8 5v4M14 13v6"/></svg>'));
      e.appendChild(g);
      e.appendChild(el("h3", null, "The register is empty"));
      e.appendChild(el("p", null, "When the hunt finds a genuine disagreement with the market, it will publish here: " +
        "the consensus, quoted and dated; the disagreement; one written way to be proved wrong; and what mainstream " +
        "arrival would look like. Every later review appends to the record, and nothing published is ever edited."));
      eh.appendChild(e);
    } else {
      alSection(ch, "Live calls", live);
      alSection(ch, "Dead calls — the record keeps its losses and its wins", dead);
    }

    const leg = $("al-legend");
    leg.innerHTML = "";
    AL_LEGEND.forEach(p => {
      const r = el("div", "legrow");
      const l = el("div"); l.appendChild(alChip(p[0]));
      r.appendChild(l);
      r.appendChild(el("span", "t", p[1]));
      leg.appendChild(r);
    });

    show("al-main");
    hide("alphastatus");
  }

  function alphaEmpty(msg) {
    const host = $("al-empty-state");
    host.innerHTML = "";
    host.appendChild(emptyBox("The hunt hasn't published yet", [
      "This tab will carry the Alpha Hunt: a weekly search for places where the market seems to believe a wrong thing. " +
      "Each call names the consensus it disagrees with, quoted and dated; states the disagreement; and is born with one " +
      "written, checkable way to be proved wrong.",
      "The record is counted in public — weeks hunted, calls opened, killed, or arrived — and “no alpha this week” is an " +
      "expected, counted answer. Dead calls keep their post-mortems on the page."
    ], msg || "Nothing is shown here until the first hunt publishes, rather than showing something unverified."));
    hide("al-main");
    hide("alphastatus");
  }

  fetch("data/alpha/latest.json?t=" + Date.now(), { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error("no hunt yet"); return r.json(); })
    .then(doc => {
      if (!doc || !doc.week || !doc.counts) throw new Error("no hunt yet");
      renderAlpha(doc);
    })
    .catch(() => { alphaEmpty(); });

  /* ==========================================================================
     EXPERIMENTS
     Tab 5 watches two paper-money experiments. Three stored files and nothing
     else: a daily status glance and one weekly document per experiment. The
     weekly histories arrive complete - the publisher refuses a truncated one -
     so this layer renders every row it is given and prints the count beside
     the table so the completeness can be checked from the page itself.
     ========================================================================== */

  /* sub-tabs: same mechanism as the top-level tabs, one level down */
  const xtabBtns = [].slice.call(document.querySelectorAll(".xtab"));
  xtabBtns.forEach(b => {
    b.addEventListener("click", () => {
      xtabBtns.forEach(o => {
        const on = o === b;
        o.setAttribute("aria-selected", on ? "true" : "false");
        $("x-" + o.dataset.x).classList.toggle("on", on);
      });
    });
  });

  const exState = { statusDate: null, mgatWeek: null, hadesWeek: null };
  function exSub() {
    sub($("ex-sub"), [
      ["2 experiments, paper money only"],
      exState.statusDate ? ["status " + exState.statusDate, true] : ["status pending"],
      exState.mgatWeek || exState.hadesWeek
        ? ["weeklies " + [exState.mgatWeek, exState.hadesWeek].filter(Boolean).join(" · "), true]
        : ["first weeklies publish Sunday morning (GMT+3)"]
    ]);
  }
  exSub();

  function usd(v, signed) {
    if (!isNum(v)) return "—";
    const t = "$" + Math.abs(v).toLocaleString("en-US",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? "−" : (signed && v > 0 ? "+" : "")) + t;
  }
  function exStat(label, value, subtext, na) {
    const s = el("div", "exst");
    s.appendChild(el("div", "l", label));
    s.appendChild(el("div", "v num" + (na ? " na" : ""), value));
    if (subtext) s.appendChild(el("div", "s", subtext));
    return s;
  }
  function xheadBlock(doc, title) {
    const h = el("div", "xhead");
    const win = doc.week_window || {};
    h.appendChild(el("div", "wk", (doc.week || "") +
      (win.start ? " · " + win.start + " → " + win.end : "")));
    h.appendChild(el("h2", null, title));
    h.appendChild(el("p", null, doc.headline || ""));
    return h;
  }
  function deltaCell(label, value, prevText, dir) {
    const c = el("div", "rc");
    c.appendChild(el("div", "l", label));
    c.appendChild(el("div", "v", value));
    if (prevText) c.appendChild(el("div", "d " + (dir || "flat"), prevText));
    return c;
  }

  /* ---------- status ---------- */
  function renderExStatus(doc) {
    exState.statusDate = doc.date;
    exSub();
    const d = new Date(doc.date + "T12:00:00Z");
    const age = Math.floor((Date.now() - d.getTime()) / 86400000);
    const sh = $("ex-status-stale");
    sh.innerHTML = "";
    if (age >= 2) {
      sh.appendChild(stale("This status is " + age + " days old. The daily check " +
        "has not run — it describes " + doc.date + ", not today."));
    }
    const host = $("ex-status-cards");
    host.innerHTML = "";
    (doc.projects || []).forEach(p => {
      const c = el("article", "exc");
      c.appendChild(el("div", "nm", p.name));
      c.appendChild(el("div", "sd", p.sub));
      const strip = el("div", "strip");
      strip.appendChild(el("span", "pill " + (p.state === "live" ? "live" : "check"),
        p.state === "live" ? "Live" : "Needs check"));
      strip.appendChild(el("span", "exupd", "last daily check · " + p.last_checked));
      c.appendChild(strip);
      if (p.state !== "live") c.appendChild(el("p", "acnote", p.state_reason || ""));
      const st = el("div", "exstats");
      st.appendChild(exStat("Win rate",
        isNum(p.win_rate_pct) ? Math.round(p.win_rate_pct) + "%" : "—",
        isNum(p.win_rate_pct) ? p.wins_today + " of " + p.closed_today + " today" : null,
        !isNum(p.win_rate_pct)));
      st.appendChild(exStat("PnL (today)", usd(p.pnl_today_usd, true),
        null, !isNum(p.pnl_today_usd)));
      st.appendChild(exStat("Trades", p.trades_label || "—", null,
        !p.trades_label || p.trades_label === "—"));
      c.appendChild(st);
      if (p.note) c.appendChild(el("div", "s exupd", p.note)).style.marginTop = "10px";
      host.appendChild(c);
    });
    const nh = $("ex-status-note");
    nh.innerHTML = "";
    const n = el("p", "exnote");
    n.appendChild(el("b", null, "Needs check"));
    n.appendChild(document.createTextNode(" means the day's health read didn't come " +
      "back clean — MGAT Alpha off its own daily health read, Hades Trading off " +
      "whether the day's report landed intact. A dash is a number no data computed " +
      "today. Everything else waits for Sunday's weeklies."));
    nh.appendChild(n);
    hide("exstatus");
  }

  function exStatusEmpty() {
    const host = $("ex-status-empty");
    host.innerHTML = "";
    host.appendChild(emptyBox("The status glance hasn't published yet", [
      "This sub-tab will carry one card per experiment — MGAT Alpha v3.1 (an autonomous " +
      "paper-trading experiment) and Hades Trading (a sealed agent with its own wallet) — " +
      "each with a live / needs-check read, its last daily check, and three numbers.",
      "Both are paper-money experiments: no client money, no advice, published as a public record."
    ], "Nothing is shown here until the first daily status lands, rather than showing something unverified."));
    hide("exstatus");
  }

  fetch("data/experiments/status/latest.json?t=" + Date.now(), { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error("no status yet"); return r.json(); })
    .then(doc => {
      if (!doc || !doc.projects || doc.projects.length !== 2) throw new Error("malformed status");
      renderExStatus(doc);
    })
    .catch(() => { exStatusEmpty(); });

  /* ---------- shared weekly bits ---------- */
  function nextSunday() {
    const d = new Date();
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  function weeklyStaleBanner(hostId, doc) {
    const sh = $(hostId);
    sh.innerHTML = "";
    const end = doc.week_window && doc.week_window.end;
    if (!end) return;
    const age = Math.floor((Date.now() - new Date(end + "T23:59:59Z").getTime()) / 86400000);
    if (age > 9) {
      sh.appendChild(stale("This weekly covers the week ending " + end + " — " + age +
        " days ago. A newer week has completed without a report."));
    }
  }

  /* ---------- MGAT Alpha weekly ---------- */
  function renderExMgat(doc) {
    exState.mgatWeek = doc.week;
    exSub();
    weeklyStaleBanner("ex-mgat-stale", doc);
    const main = $("ex-mgat-main");
    main.innerHTML = "";
    const t = doc.totals || {}, vp = doc.vs_previous;

    const head = xheadBlock(doc, "MGAT Alpha v3.1 — paper-money experiment");
    const cave = el("div", "xcave");
    const cd = el("div");
    cd.appendChild(el("div", null, doc.paper_caveat || ""));
    cd.appendChild(el("div", null, doc.sample_caveat || ""));
    if (doc.integrity) cd.appendChild(el("div", null, doc.integrity));
    cave.appendChild(cd);
    head.appendChild(cave);
    main.appendChild(head);

    const st1 = el("div", "stitle");
    st1.appendChild(el("h2", null, "vs previous week"));
    st1.appendChild(el("span", "rule"));
    st1.appendChild(el("span", "tag", vp ? "against " + vp.week + ", read from its published file"
      : "first report — no baseline"));
    main.appendChild(st1);
    const rec = el("div", "record r4");
    function dtext(cur, prev, fmt) {
      if (!vp || !isNum(prev)) return null;
      return "from " + fmt(prev);
    }
    function ddir(cur, prev) {
      if (!vp || !isNum(prev) || !isNum(cur) || cur === prev) return "flat";
      return cur > prev ? "up" : "dn";
    }
    rec.appendChild(deltaCell("Trades closed", String(t.closed),
      dtext(t.closed, vp && vp.closed, String), ddir(t.closed, vp && vp.closed)));
    rec.appendChild(deltaCell("Win rate",
      isNum(t.win_rate_pct) ? Math.round(t.win_rate_pct) + "%" : "—",
      vp ? (isNum(vp.win_rate_pct) ? "from " + Math.round(vp.win_rate_pct) + "%" : "prev week: no closes") : null,
      ddir(t.win_rate_pct, vp && vp.win_rate_pct)));
    rec.appendChild(deltaCell("PnL", usd(t.pnl_usd, true),
      vp ? "from " + usd(vp.pnl_usd, true) : null, ddir(t.pnl_usd, vp && vp.pnl_usd)));
    const cf = doc.counterfactual || {};
    let cfv = "—", cfs = cf.closed === 0 ? "counterfactual closed nothing" : null, cfd = "flat";
    if (isNum(t.pnl_usd) && isNum(cf.pnl_usd)) {
      const diff = t.pnl_usd - cf.pnl_usd;
      cfv = usd(diff, true);
      cfs = diff >= 0 ? "ahead of the counterfactual book" : "behind the counterfactual book";
      cfd = diff > 0 ? "up" : (diff < 0 ? "dn" : "flat");
    }
    rec.appendChild(deltaCell("vs counterfactual", cfv, cfs, cfd));
    main.appendChild(rec);

    if ((doc.families || []).length) {
      const st2 = el("div", "stitle");
      st2.appendChild(el("h2", null, "Per family"));
      st2.appendChild(el("span", "rule"));
      main.appendChild(st2);
      const wrap = el("div", "xhwrap");
      const tb = document.createElement("table");
      tb.className = "xh";
      tb.innerHTML = "<thead><tr><th>Family</th><th>Trades</th><th>Win rate</th><th>PnL</th></tr></thead>";
      const body = document.createElement("tbody");
      doc.families.forEach(f => {
        const r = document.createElement("tr");
        r.appendChild(el("td", "lft", f.family));
        r.appendChild(el("td", "num", String(f.closed)));
        r.appendChild(el("td", "num", isNum(f.win_rate_pct) ? Math.round(f.win_rate_pct) + "%" : "—"));
        const pc = el("td", "num " + dirOf(f.pnl_usd || 0), usd(f.pnl_usd, true));
        r.appendChild(pc);
        body.appendChild(r);
      });
      tb.appendChild(body);
      wrap.appendChild(tb);
      main.appendChild(wrap);
    }

    const vb = el("div", "xvbox");
    vb.style.marginTop = "20px";
    const r1 = el("div", "row");
    r1.appendChild(el("b", null, "Reviewer read — " + ((doc.verdict || {}).call || "") + ". "));
    r1.appendChild(document.createTextNode((doc.verdict || {}).text || ""));
    vb.appendChild(r1);
    const bits = [];
    const bs = doc.beta_share || {};
    bits.push(isNum(bs.measured_pct)
      ? "measured-beta share " + Math.round(bs.measured_pct) + "% of " + bs.opens + " opens"
      : "no opens this week");
    const rg = doc.regime || {};
    if (isNum(rg.cycles)) bits.push("regime: " + rg.risk_on + " risk-on / " + rg.risk_off +
      " risk-off / " + rg.unknown + " unknown across " + rg.cycles + " cycles");
    bits.push((doc.faults || []).length
      ? "faults: " + doc.faults.map(f => f.kind + "×" + f.count + " (" + f.severity + ")").join(", ")
      : "no faults this week");
    bits.push("LLM adviser: " + (doc.llm_adviser || "N/A"));
    const r2 = el("div", "row");
    r2.appendChild(document.createTextNode(bits.join(" · ")));
    vb.appendChild(r2);
    main.appendChild(vb);

    const st3 = el("div", "stitle");
    st3.appendChild(el("h2", null, "Full trade history — this week"));
    st3.appendChild(el("span", "rule"));
    st3.appendChild(el("span", "tag", doc.history.length + " of " + t.closed + " closes"));
    main.appendChild(st3);
    if (!doc.history.length) {
      main.appendChild(emptyBox("No trades closed this week", [
        "The book closed nothing in this window; there are no rows to show. " +
        "An empty table with a stated reason beats a hidden one."]));
    } else {
      const wrap = el("div", "xhwrap");
      const tb = document.createElement("table");
      tb.className = "xh wide";
      tb.innerHTML = "<thead><tr><th>Date</th><th>Family</th><th class='lft'>Symbol</th>" +
        "<th>Entry</th><th>Exit</th><th>PnL</th><th>Beta</th><th class='lft'>Beta source</th></tr></thead>";
      const body = document.createElement("tbody");
      doc.history.forEach(h => {
        const r = document.createElement("tr");
        r.appendChild(el("td", "lft num", h.date.slice(5)));
        r.appendChild(el("td", "lft", h.family));
        r.appendChild(el("td", "lft", h.symbol));
        r.appendChild(el("td", "num", fmtLevel(h.entry_price)));
        r.appendChild(el("td", "num", isNum(h.exit_price) ? fmtLevel(h.exit_price) : "—"));
        r.appendChild(el("td", "num " + dirOf(h.pnl_usd), usd(h.pnl_usd, true)));
        r.appendChild(el("td", "num", isNum(h.beta) ? h.beta.toFixed(2) : "—"));
        r.appendChild(el("td", "lft", h.beta_source || "—"));
        body.appendChild(r);
      });
      tb.appendChild(body);
      wrap.appendChild(tb);
      main.appendChild(wrap);
      main.appendChild(el("p", "xfoot", "All " + doc.history.length + " closes this week — " +
        "nothing cut. Same rule as the rest of the site: a table that hides rows is a table " +
        "that can't be checked, and the publisher refuses one."));
    }
    show("ex-mgat-main");
    hide("exmgatstatus");
  }

  function exMgatEmpty() {
    const host = $("ex-mgat-empty");
    host.innerHTML = "";
    host.appendChild(emptyBox("The first MGAT Alpha weekly publishes " + nextSunday(), [
      "Every Sunday this sub-tab will carry the week's paper-trading record: trades closed, " +
      "win rate, PnL against the counterfactual book, the per-family split, and the reviewer's " +
      "plain-language read — ending with every close of the week, never truncated.",
      "MGAT Alpha v3.1 is a paper experiment: simulated fills, zero capital, published as a public record."
    ], "Nothing is shown here until then, rather than showing something unverified."));
    hide("exmgatstatus");
  }

  fetch("data/experiments/mgat/latest.json?t=" + Date.now(), { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error("no weekly yet"); return r.json(); })
    .then(doc => {
      if (!doc || !doc.week || !doc.totals || !doc.history) throw new Error("malformed weekly");
      renderExMgat(doc);
    })
    .catch(() => { exMgatEmpty(); });

  /* ---------- Hades weekly ---------- */
  function renderExHades(doc) {
    exState.hadesWeek = doc.week;
    exSub();
    weeklyStaleBanner("ex-hades-stale", doc);
    const main = $("ex-hades-main");
    main.innerHTML = "";
    main.appendChild(xheadBlock(doc, "Hades Trading — paper-money experiment"));

    const st1 = el("div", "stitle");
    st1.appendChild(el("h2", null, "The verdict — three lines, in order"));
    st1.appendChild(el("span", "rule"));
    st1.appendChild(el("span", "tag", "every figure carries its provenance"));
    main.appendChild(st1);
    const vl = el("div", "vlines");
    (doc.verdict_lines || []).forEach(ln => {
      const row = el("div", "vline");
      const l = el("span", "l");
      l.appendChild(el("span", "ptag " + ln.tag, ln.tag));
      l.appendChild(document.createTextNode(ln.label));
      row.appendChild(l);
      row.appendChild(el("span", "v", ln.value));
      vl.appendChild(row);
    });
    main.appendChild(vl);
    if (doc.verdict_note) {
      const cv = el("div", "xcave");
      cv.style.margin = "0 0 20px";
      cv.appendChild(el("div", null, doc.verdict_note));
      main.appendChild(cv);
    }

    const n = doc.numbers || {}, vp = doc.vs_previous;
    const st2 = el("div", "stitle");
    st2.appendChild(el("h2", null, "vs previous week"));
    st2.appendChild(el("span", "rule"));
    st2.appendChild(el("span", "tag", vp ? "against " + vp.week + ", read from its published file"
      : "first report — no baseline"));
    main.appendChild(st2);
    const rec = el("div", "record r4");
    rec.appendChild(deltaCell("Trades", String(doc.trades_count),
      vp ? "from " + vp.trades : null,
      vp && isNum(vp.trades) && doc.trades_count !== vp.trades
        ? (doc.trades_count > vp.trades ? "up" : "dn") : "flat"));
    rec.appendChild(deltaCell("Wallet value", usd(n.wallet_usd),
      vp && isNum(vp.wallet_usd) ? "from " + usd(vp.wallet_usd) : null,
      vp && isNum(vp.wallet_usd) && isNum(n.wallet_usd)
        ? (n.wallet_usd > vp.wallet_usd ? "up" : (n.wallet_usd < vp.wallet_usd ? "dn" : "flat")) : "flat"));
    rec.appendChild(deltaCell("SOL held", isNum(n.sol_balance) ? String(n.sol_balance) : "—",
      vp && isNum(vp.sol_balance) ? "from " + vp.sol_balance : null,
      vp && isNum(vp.sol_balance) && isNum(n.sol_balance)
        ? (n.sol_balance > vp.sol_balance ? "up" : (n.sol_balance < vp.sol_balance ? "dn" : "flat")) : "flat"));
    rec.appendChild(deltaCell("Spot SOL", usd(n.sol_spot_usd), "market price, not his doing", "flat"));
    main.appendChild(rec);

    const vb = el("div", "xvbox");
    [["What he did", doc.what_he_did], ["Good", doc.good], ["Bad", doc.bad],
     ["vs last week", doc.vs_last_week]].forEach(pair => {
      if (!pair[1]) return;
      const r = el("div", "row");
      r.appendChild(el("b", null, pair[0] + ": "));
      r.appendChild(document.createTextNode(pair[1]));
      vb.appendChild(r);
    });
    if ((doc.watching || []).length) {
      const r = el("div", "row");
      r.appendChild(el("b", null, "Keep watching: "));
      r.appendChild(document.createTextNode(doc.watching.join(" · ")));
      vb.appendChild(r);
    }
    main.appendChild(vb);

    const st3 = el("div", "stitle");
    st3.appendChild(el("h2", null, "The week, day by day — his own words"));
    st3.appendChild(el("span", "rule"));
    st3.appendChild(el("span", "tag", doc.days.length + " of 7 days"));
    main.appendChild(st3);
    doc.days.forEach(d => {
      const dr = document.createElement("details");
      dr.className = "drow";
      const s = document.createElement("summary");
      s.appendChild(el("span", "dd", d.date.slice(5)));
      s.appendChild(el("span", "dl", d.label));
      s.appendChild(el("span", "dr", d.result));
      dr.appendChild(s);
      const b = el("div", "body");
      if (d.quote) b.appendChild(el("p", "quote", "“" + d.quote + "”"));
      else b.appendChild(el("p", "anote", "No words to quote — " + d.label + "."));
      if (d.atlas_note && d.atlas_note !== "—" && d.atlas_note !== "-") {
        b.appendChild(el("p", "anote", "Note (ours, not his): " + d.atlas_note));
      }
      dr.appendChild(b);
      main.appendChild(dr);
    });
    main.appendChild(el("p", "xfoot", "Every day of the week has its row, deliberate " +
      "non-trade days included, quoted verbatim from his own journal — nothing cut. " +
      "His words are his account of himself; the measured figures above are the check on them."));
    show("ex-hades-main");
    hide("exhadesstatus");
  }

  function exHadesEmpty() {
    const host = $("ex-hades-empty");
    host.innerHTML = "";
    host.appendChild(emptyBox("The first Hades Trading weekly publishes " + nextSunday(), [
      "Every Sunday this sub-tab will carry the week against the signed baselines — the wallet's " +
      "dollar value vs $130.00, the SOL balance vs 1.36228651, and the do-nothing counterfactual — " +
      "with every figure tagged measured, claimed or market, and one row per day in his own words, " +
      "deliberate non-trade days included, nothing cut.",
      "Hades Trading is a sealed experiment: an agent holding its own wallet, no human decisions in " +
      "the loop, published as a public record."
    ], "Nothing is shown here until then, rather than showing something unverified."));
    hide("exhadesstatus");
  }

  fetch("data/experiments/hades/latest.json?t=" + Date.now(), { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error("no weekly yet"); return r.json(); })
    .then(doc => {
      if (!doc || !doc.week || !doc.verdict_lines || !doc.days) throw new Error("malformed weekly");
      renderExHades(doc);
    })
    .catch(() => { exHadesEmpty(); });
})();
