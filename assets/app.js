(function () {
  "use strict";

  var GROUPS = ["Commodities", "Indices & macro", "Stocks", "Crypto", "Oil & gas majors"];

  function fmtPrice(v, currency) {
    if (v === null || v === undefined || isNaN(v)) return null;
    if (currency === "RATIO") return v.toFixed(2) + "×";
    if (currency === "USD_BN") {
      return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 1 }) + "B";
    }
    var d = Math.abs(v) >= 1 ? 2 : (Math.abs(v) >= 0.01 ? 4 : 6);
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function pctCell(v, label) {
    var td = document.createElement("td");
    td.setAttribute("data-label", label);
    if (v === null || v === undefined || isNaN(v)) {
      td.className = "na";
      td.textContent = "N/A";
      return td;
    }
    td.className = "num " + (v > 0.005 ? "up" : (v < -0.005 ? "down" : "flat"));
    td.textContent = (v > 0 ? "+" : "") + v.toFixed(2) + "%";
    return td;
  }

  function render(doc) {
    var host = document.getElementById("tables");
    host.innerHTML = "";

    var byGroup = {};
    doc.assets.forEach(function (a) {
      (byGroup[a.group] = byGroup[a.group] || []).push(a);
    });

    var names = GROUPS.filter(function (g) { return byGroup[g]; })
      .concat(Object.keys(byGroup).filter(function (g) { return GROUPS.indexOf(g) === -1; }));

    names.forEach(function (g) {
      var sec = document.createElement("section");
      sec.className = "group";

      var h = document.createElement("h2");
      h.textContent = g;
      sec.appendChild(h);

      var card = document.createElement("div");
      card.className = "tablecard";
      var table = document.createElement("table");

      var thead = document.createElement("thead");
      var hr = document.createElement("tr");
      ["Asset", "Price", "24h", "7d", "30d", "YTD"].forEach(function (t) {
        var th = document.createElement("th");
        th.textContent = t;
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);

      var tbody = document.createElement("tbody");
      byGroup[g].forEach(function (a) {
        var tr = document.createElement("tr");

        var name = document.createElement("td");
        name.textContent = a.name;
        if (a.as_of) {
          var s = document.createElement("span");
          s.className = "asof";
          s.textContent = "as of " + a.as_of;
          name.appendChild(s);
        }
        tr.appendChild(name);

        var price = document.createElement("td");
        var p = fmtPrice(a.price_usd, a.currency);
        if (p === null) { price.className = "na"; price.textContent = "N/A"; }
        else { price.className = "num price"; price.textContent = p; }
        tr.appendChild(price);

        tr.appendChild(pctCell(a.chg_24h, "24h"));
        tr.appendChild(pctCell(a.chg_7d, "7d"));
        tr.appendChild(pctCell(a.chg_30d, "30d"));
        tr.appendChild(pctCell(a.chg_ytd, "YTD"));

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      card.appendChild(table);
      sec.appendChild(card);
      host.appendChild(sec);
    });

    // A dead cron must announce itself. Without this the page would keep
    // showing yesterday's numbers as though they were today's.
    var when = new Date(doc.generated_utc);
    var ageHours = (Date.now() - when.getTime()) / 3600000;
    if (ageHours > 36) {
      var warn = document.createElement("div");
      warn.className = "stale";
      warn.textContent = "These figures are " + Math.floor(ageHours / 24) +
        " day(s) old. The daily update has not run — treat them as historical, not current.";
      host.insertBefore(warn, host.firstChild);
    }
    document.getElementById("stamp").textContent =
      "updated " + when.toLocaleString(undefined, {
        year: "numeric", month: "short", day: "2-digit",
        hour: "2-digit", minute: "2-digit"
      });
    document.getElementById("status").style.display = "none";
  }

  function fail(msg) {
    var s = document.getElementById("status");
    s.textContent = msg;
    document.getElementById("stamp").textContent = "unavailable";
  }

  fetch("data/latest.json?t=" + Date.now(), { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (doc) {
      if (!doc || !doc.assets || !doc.assets.length) throw new Error("no assets in feed");
      render(doc);
    })
    .catch(function (e) {
      fail("Market data could not be loaded (" + e.message + "). Nothing is shown rather than showing stale numbers.");
    });

  // ---------------------------------------------------------------- brief

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function renderBrief(doc) {
    var host = document.getElementById("briefbody");
    host.innerHTML = "";

    var head = el("div", "briefhead");
    head.appendChild(el("h1", null, "Daily Brief"));
    var d = new Date(doc.date + "T12:00:00Z");
    head.appendChild(el("div", "briefdate", d.toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    }) + " · " + (doc.lookback_days || 7) + "-day lookback"));
    host.appendChild(head);

    // Same honesty rule as the price table: say when it is old.
    var ageDays = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (ageDays >= 2) {
      host.appendChild(el("div", "stale", "This brief is " + ageDays +
        " days old. The daily update has not run — it describes that date, not today."));
    }

    (doc.sections || []).forEach(function (sec) {
      var wrapEl = el("section", "bsec");
      wrapEl.appendChild(el("h2", null, sec.name));
      if (!sec.items || !sec.items.length) {
        wrapEl.appendChild(el("p", "bnone", "Nothing notable this week."));
        host.appendChild(wrapEl);
        return;
      }
      sec.items.forEach(function (it) {
        var card = el("article", "bitem");
        card.appendChild(el("h3", null, it.headline));
        card.appendChild(el("p", null, it.why));
        var srcs = it.sources || [];
        if (srcs.length) {
          var row = el("div", "bsrc");
          srcs.forEach(function (sr) {
            var a = el("a", null, sr.title || "source");
            a.href = sr.url;
            a.target = "_blank";
            a.rel = "noopener noreferrer nofollow";
            row.appendChild(a);
          });
          card.appendChild(row);
        }
        wrapEl.appendChild(card);
      });
      host.appendChild(wrapEl);
    });

    document.getElementById("briefstatus").style.display = "none";
  }

  function briefEmpty(msg) {
    var host = document.getElementById("briefbody");
    host.innerHTML = "";
    var box = el("div", "empty");
    box.appendChild(el("h2", null, "The daily brief isn't running yet"));
    box.appendChild(el("p", null, "This tab will carry a written market brief — tech, crypto, " +
      "macro and geopolitics, commodities, and technical levels — generated once a day and " +
      "filtered down to what actually moved."));
    box.appendChild(el("p", "muted", msg || "Nothing is shown here rather than showing something unverified."));
    host.appendChild(box);
    document.getElementById("briefstatus").style.display = "none";
  }

  fetch("data/brief/latest.json?t=" + Date.now(), { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("no brief yet"); return r.json(); })
    .then(function (doc) {
      if (!doc || !doc.sections || !doc.sections.length) throw new Error("empty brief");
      renderBrief(doc);
    })
    .catch(function () { briefEmpty(); });

  // tabs
  var tabs = [].slice.call(document.querySelectorAll(".tab"));
  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      tabs.forEach(function (o) {
        var on = o === t;
        o.classList.toggle("is-active", on);
        o.setAttribute("aria-selected", on ? "true" : "false");
        document.getElementById(o.dataset.panel).classList.toggle("is-active", on);
      });
    });
  });
})();
