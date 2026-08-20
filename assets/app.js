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
        " day(s) old. The update job has not run — treat them as historical, not current.";
      host.insertBefore(warn, host.firstChild);
    }
    // Compact on purpose - the long locale form truncates on a phone.
    document.getElementById("stamp").textContent =
      "updated " + when.toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric"
      }) + ", " + when.toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit", hour12: false
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

  // ---------------------------------------------------------------- weekly

  var STATE_CLASS = {
    "Buy": "st-buy", "Hold": "st-hold", "Flat": "st-flat", "Wait": "st-wait",
    "Sell": "st-sell", "No read": "st-noread", "No data": "st-nodata"
  };
  var LEGEND = [
    ["Buy", "At or near a bottom, or expected to rise significantly."],
    ["Hold", "In an uptrend, expected to continue. The easy entry has passed."],
    ["Flat", "Sideways inside a stated range. No trend to join either way."],
    ["Wait", "Falling, no base formed. Not a buy yet — the mirror of Hold."],
    ["Sell", "At or near a top, or expected to drop significantly."],
    ["No read", "Market not legible — a dated tier-one event falls in the window. No forecast."],
    ["No data", "Feed broken or stale. Nothing analysed because there was nothing to analyse."]
  ];

  function fmtLevel(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    var d = Math.abs(v) >= 1000 ? 0 : (Math.abs(v) >= 10 ? 2 : 4);
    return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function chip(state) {
    return el("span", "stchip " + (STATE_CLASS[state] || "st-flat"), state);
  }
  function pctSpan(v, digits) {
    var s = el("span", "num " + (v > 0.005 ? "up" : (v < -0.005 ? "down" : "flat")));
    s.textContent = (v > 0 ? "+" : "") + v.toFixed(digits === undefined ? 2 : digits) + "%";
    return s;
  }
  function statBox(label, value, sub) {
    var b = el("div", "stat");
    b.appendChild(el("div", "stat-label", label));
    var v = el("div", "stat-value");
    if (value instanceof Node) v.appendChild(value); else v.textContent = value;
    b.appendChild(v);
    if (sub) b.appendChild(el("div", "stat-sub", sub));
    return b;
  }
  function rangeLine(label, h) {
    var row = el("div", "hz");
    row.appendChild(el("div", "hz-label", label));
    var body = el("div", "hz-body");
    body.appendChild(el("div", "hz-range",
      fmtLevel(h.lo) + " – " + fmtLevel(h.hi)));
    body.appendChild(el("div", "hz-sub", "80% range · base " + fmtLevel(h.base) +
      " (no-change) · to " + h.target_date));
    row.appendChild(body);
    return row;
  }

  function renderWeekly(doc) {
    var host = document.getElementById("weeklybody");
    host.innerHTML = "";

    var head = el("div", "briefhead");
    head.appendChild(el("h1", null, "Weekly Review"));
    var fri = doc.review_friday || "";
    head.appendChild(el("div", "briefdate",
      (doc.week || "") + " · week ending " + fri +
      (doc.published_utc ? " · published " + doc.published_utc.slice(0, 10) : "") +
      " · next review Saturday morning (GMT+3)"));
    if (doc.vintage && doc.vintage.note) {
      head.appendChild(el("div", "vintage-note", "Note: " + doc.vintage.note +
        " — data as of " + doc.vintage.asof + "."));
    }
    host.appendChild(head);

    // honesty banner when a newer week has completed and no review covers it
    if (doc.review_friday) {
      var age = Math.floor((Date.now() - new Date(fri + "T23:59:59Z").getTime()) / 86400000);
      if (age > 9) {
        host.appendChild(el("div", "stale", "This review covers the week ending " +
          fri + " — " + age + " days ago. A newer week has completed without a review."));
      }
    }

    // scorecard
    var sc = doc.scorecard || {};
    var grid = el("div", "statgrid");
    var thisWeek = doc.assets.filter(function (a) {
      return a.forecast && a.stance;
    }).length;
    grid.appendChild(statBox("This week", thisWeek + " called",
      (doc.declines ? (doc.declines.no_read + " declined · " +
        doc.declines.no_data + " no data") : "")));
    var r12 = (sc.rolling_12w || {}).directional || {};
    grid.appendChild(statBox("Rolling 12w", r12.n ?
      Math.round(r12.rate * 100) + "%" : "—",
      r12.n ? r12.hit + "/" + r12.n + " directional calls" : "record starts this week"));
    var all = (sc.weekly || {}).directional || {};
    grid.appendChild(statBox("All time", all.n ?
      Math.round(all.rate * 100) + "%" : "—",
      all.n ? all.hit + "/" + all.n + " directional calls" : "record starts this week"));
    var rng = (sc.weekly || {}).range_1w || {};
    grid.appendChild(statBox("Range coverage", rng.n ?
      Math.round(rng.coverage * 100) + "%" : "—",
      rng.n ? rng.hit + "/" + rng.n + " weekly ranges (target 80%)" : "target 80%"));
    grid.appendChild(statBox("Avg range width", (sc.weekly && sc.weekly.avg_width_pct != null) ?
      sc.weekly.avg_width_pct.toFixed(1) + "%" : "—", "published weekly ranges"));
    var br = (sc.weekly || {}).best_read;
    var wr = (sc.weekly || {}).worst_read;
    grid.appendChild(statBox("Best / worst read",
      br ? (br.asset + " " + br.stance) : "—",
      wr ? ("worst: " + wr.asset + " " + wr.stance) : "no scored calls yet"));
    host.appendChild(grid);

    // asset cards
    (doc.assets || []).forEach(function (a, i) {
      var card = document.createElement("details");
      card.className = "acard";
      if (i === 0) card.open = true;

      var sum = document.createElement("summary");
      var srow = el("div", "acard-head");
      var left = el("div", "acard-name");
      left.appendChild(el("span", "aname", a.name));
      if (a.price !== undefined && a.price !== null) {
        left.appendChild(el("span", "aprice", fmtLevel(a.price)));
      }
      srow.appendChild(left);
      var right = el("div", "acard-side");
      if (a.week_change_pct !== undefined && a.week_change_pct !== null) {
        right.appendChild(pctSpan(a.week_change_pct));
      }
      right.appendChild(chip(a.state));
      srow.appendChild(right);
      sum.appendChild(srow);
      card.appendChild(sum);

      var body = el("div", "acard-body");

      if (a.state === "No data") {
        body.appendChild(el("p", "acard-reason",
          "No data: " + (a.reason || "feed unavailable") + " Nothing is analysed, " +
          "nothing is scored, and this does not spend the weekly decline allowance."));
      } else if (a.state === "No read") {
        var nr = a.no_read || {};
        body.appendChild(el("p", "acard-reason",
          "No read: " + (nr.name || "a tier-one event") + " falls inside the forecast " +
          "window (" + (nr.date || "") + "). No forecast is made; this is counted on " +
          "the record as a decline."));
        if (a.words && a.words.note) body.appendChild(el("p", null, a.words.note));
      } else if (a.forecast) {
        body.appendChild(el("div", "provline", "last close " + (a.price_date || "?") +
          " · source " + (a.source || "?")));
        var hzwrap = el("div", "hzwrap");
        if (a.forecast.next_week) hzwrap.appendChild(rangeLine("Next week", a.forecast.next_week));
        if (a.forecast.next_month) hzwrap.appendChild(rangeLine("Next month", a.forecast.next_month));
        if (a.forecast.eoy) {
          var e = a.forecast.eoy;
          var row = el("div", "hz");
          row.appendChild(el("div", "hz-label", "End of year"));
          var eb = el("div", "hz-body");
          eb.appendChild(el("div", "hz-range",
            fmtLevel(e.central.lo) + " – " + fmtLevel(e.central.hi)));
          eb.appendChild(el("div", "hz-sub", "central scenario (50%) · upside 25% above " +
            fmtLevel(e.upside.above) + " · downside 25% below " + fmtLevel(e.downside.below)));
          eb.appendChild(el("div", "hz-sub", "Scenarios, not a forecast — excluded from the accuracy record."));
          row.appendChild(eb);
          hzwrap.appendChild(row);
        }
        body.appendChild(hzwrap);

        if (a.stance) {
          var st = el("div", "stanceline");
          st.appendChild(chip(a.stance.state));
          var conf = (a.stance.confidence !== null && a.stance.confidence !== undefined)
            ? Math.round(a.stance.confidence * 100) + "%" : "—";
          st.appendChild(el("span", "stancetext",
            "flips to " + (a.stance.flip_to || "?") + " near " +
            fmtLevel(a.stance.flip_level) + " · confidence " + conf +
            " that the one-week claim holds (historical)"));
          body.appendChild(st);
        }

        var w = a.words || {};
        if (w.technical) {
          body.appendChild(el("h4", null, "Technical read"));
          body.appendChild(el("p", null, w.technical));
        }
        if (w.macro) {
          body.appendChild(el("h4", null, "Macro read"));
          body.appendChild(el("p", null, w.macro));
        }
        if (w.eoy_scenarios) {
          body.appendChild(el("h4", null, "End-of-year scenarios"));
          ["central", "upside", "downside"].forEach(function (k) {
            if (w.eoy_scenarios[k]) {
              var p = el("p", "scen");
              p.appendChild(el("b", null, k.charAt(0).toUpperCase() + k.slice(1) + ": "));
              p.appendChild(document.createTextNode(w.eoy_scenarios[k]));
              body.appendChild(p);
            }
          });
        }
        if (w.long_term) {
          body.appendChild(el("h4", null, "Long-term note"));
          body.appendChild(el("p", null, w.long_term));
        }
        if (w.citations && w.citations.length) {
          var srcrow = el("div", "bsrc");
          w.citations.forEach(function (c) {
            var link = el("a", null, (c.title || "source") +
              (c.date ? " (" + c.date + ")" : ""));
            link.href = c.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer nofollow";
            srcrow.appendChild(link);
          });
          body.appendChild(srcrow);
        }
      }

      var lw = a.last_week;
      body.appendChild(el("div", "lastweek", lw
        ? ("Last week: " + (lw.stance || "—") +
           (lw.stance_hit === true ? " · hit" : (lw.stance_hit === false ? " · miss" : "")) +
           (lw.range_hit === true ? " · inside range" :
            (lw.range_hit === false ? " · outside range" : "")) +
           (lw.realized_pct !== null && lw.realized_pct !== undefined ?
            " · moved " + (lw.realized_pct > 0 ? "+" : "") + lw.realized_pct.toFixed(2) + "%" : ""))
        : "First review for this asset — no prior call to score."));

      card.appendChild(body);
      host.appendChild(card);
    });

    // coherence note, when the report carries one
    if (doc.coherence && doc.coherence.note) {
      var cnote = el("p", "cohnote", "Cross-asset note: " + doc.coherence.note);
      host.appendChild(cnote);
    }

    // legend
    var leg = el("section", "legend");
    leg.appendChild(el("h2", null, "The seven states"));
    LEGEND.forEach(function (pair) {
      var rowl = el("div", "legrow");
      rowl.appendChild(chip(pair[0]));
      rowl.appendChild(el("span", "legtext", pair[1]));
      leg.appendChild(rowl);
    });
    leg.appendChild(el("p", "legfoot",
      "These describe the market's state, not a portfolio position. Every number on " +
      "this tab is produced by a deterministic script from frozen, backtested " +
      "parameters; the written commentary explains those numbers and may never " +
      "change them. Forecasts are stored before the period they cover and scored " +
      "after it by script — the record above includes every call, and a declined " +
      "read is never free."));
    host.appendChild(leg);

    document.getElementById("weeklystatus").style.display = "none";
  }

  function weeklyEmpty(msg) {
    var host = document.getElementById("weeklybody");
    host.innerHTML = "";
    var box = el("div", "empty");
    box.appendChild(el("h2", null, "The weekly review isn't running yet"));
    box.appendChild(el("p", null, "This tab will carry a weekly market review of seven " +
      "instruments — a technical and macro read, calibrated forecast ranges, a stance " +
      "with its flip level, and a running accuracy record scored by script."));
    box.appendChild(el("p", "muted", msg || "Nothing is shown here rather than showing something unverified."));
    host.appendChild(box);
    document.getElementById("weeklystatus").style.display = "none";
  }

  fetch("data/weekly/latest.json?t=" + Date.now(), { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("no review yet"); return r.json(); })
    .then(function (doc) {
      if (!doc || !doc.assets || doc.assets.length !== 7) throw new Error("malformed review");
      renderWeekly(doc);
    })
    .catch(function () { weeklyEmpty(); });

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
