// The free day calculators. Everything runs in the browser: nothing typed here is sent or stored.
// Each page carries its rule and its words in data-calc, written by tools/build_calculators.py.
(function () {
  "use strict";
  var root = document.querySelector("[data-calc]");
  if (!root) return;
  var cfg = JSON.parse(root.getAttribute("data-calc"));
  var t = cfg.text;
  var DAY = 86400000;
  var tripsBox = root.querySelector(".trips");
  var asofInput = root.querySelector(".asof");
  var result = root.querySelector(".result");
  var fmt = new Intl.DateTimeFormat(cfg.lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  // Days are whole numbers counted from 1 January 1970, so there are no time zones to trip over.
  function parse(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
    var p = value.split("-");
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY;
  }
  function show(day) { return fmt.format(new Date(day * DAY)); }
  function yearOf(day) { return new Date(day * DAY).getUTCFullYear(); }
  function yearStart(year) { return Date.UTC(year, 0, 1) / DAY; }
  // A key with "1" on the end holds the singular wording, used when n is 1.
  function say(key, values) {
    var text = values && values.n === 1 && t[key + "1"] ? t[key + "1"] : t[key];
    return text.replace(/\{(\w+)\}/g, function (_, k) { return values[k]; });
  }
  function today() {
    var d = new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY;
  }
  function iso(day) { return new Date(day * DAY).toISOString().slice(0, 10); }

  function addTrip(from, to) {
    var row = document.createElement("div");
    row.className = "trip";
    row.innerHTML =
      '<label><span>' + t.enteredLabel + '</span><input type="date" class="from"></label>' +
      '<label><span>' + t.leftLabel + '</span><input type="date" class="to"></label>' +
      '<button type="button" class="remove" aria-label="' + t.remove + '">×</button>';
    row.querySelector(".from").value = from || "";
    row.querySelector(".to").value = to || "";
    row.querySelector(".remove").addEventListener("click", function () {
      row.remove();
      if (!tripsBox.children.length) addTrip();
      update();
    });
    tripsBox.appendChild(row);
    return row;
  }

  // The set of days present. A trip with no exit date runs to the count date.
  function presence(asof) {
    var days = Object.create(null);
    var rows = tripsBox.querySelectorAll(".trip");
    var any = false;
    for (var i = 0; i < rows.length; i++) {
      var from = parse(rows[i].querySelector(".from").value);
      var to = parse(rows[i].querySelector(".to").value);
      rows[i].classList.toggle("bad", from !== null && to !== null && to < from);
      if (from === null) continue;
      if (to === null) to = Math.max(from, asof);
      if (to < from) continue;
      if (to - from > 3660) continue; // A typo, not a ten-year trip.
      for (var d = from; d <= to; d++) days[d] = true;
      any = true;
    }
    return any ? days : null;
  }

  function windowCount(days, end, length) {
    var n = 0;
    for (var d = end - length + 1; d <= end; d++) if (days[d]) n++;
    return n;
  }

  function rolling(days, asof) {
    var w = cfg.window, limit = cfg.limit, html = "";
    var used = windowCount(days, asof, w);
    html += '<p class="big"><b>' + used + '</b><span>' + say("countLabel", { date: show(asof) }) + "</span></p>";
    if (used > limit) {
      html += '<p class="state over">' + say("over", { n: used - limit }) + "</p>";
    } else {
      html += '<p class="state">' + say("left", { n: limit - used }) + "</p>";
    }
    // The first day any entered trip goes past the limit, past or planned.
    var sorted = Object.keys(days).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < sorted.length; i++) {
      var n = windowCount(days, sorted[i], w);
      if (n > limit) { html += "<p>" + say("crossed", { date: show(sorted[i]), n: n }) + "</p>"; break; }
    }
    // Staying every day from the count date on.
    if (used <= limit) {
      var stay = Object.create(null), k;
      for (k in days) stay[k] = true;
      for (var d = asof; d <= asof + 2 * w; d++) {
        stay[d] = true;
        if (windowCount(stay, d, w) > limit) {
          html += "<p>" + (d === asof && cfg.projectLastAllowed
            ? say("projectNone", { start: show(asof) })
            : say("project", { start: show(asof), date: show(cfg.projectLastAllowed ? d - 1 : d) })) + "</p>";
          break;
        }
      }
    }
    return html;
  }

  function weighted(days, asof) {
    var year = yearOf(asof), html = "";
    var y0 = yearStart(year), y1 = yearStart(year - 1), y2 = yearStart(year - 2);
    function between(a, b) { var n = 0; for (var d = a; d <= b; d++) if (days[d]) n++; return n; }
    var d0 = between(y0, asof), d1 = between(y1, y0 - 1), d2 = between(y2, y1 - 1);
    var total = d0 + d1 / 3 + d2 / 6;
    function one(x) { return (Math.round(x * 10) / 10).toLocaleString(cfg.lang); }
    html += '<p class="big"><b>' + one(total) + '</b><span>' + say("countLabel", { year: year, date: show(asof) }) + "</span></p>";
    html += '<table class="weights"><tbody>' +
      [[year, d0, "1", d0], [year - 1, d1, "1/3", d1 / 3], [year - 2, d2, "1/6", d2 / 6]].map(function (r) {
        return "<tr><td>" + r[0] + "</td><td>" + say("days", { n: r[1] }) + "</td><td>× " + r[2] + "</td><td>" + one(r[3]) + "</td></tr>";
      }).join("") + "</tbody></table>";
    var met = d0 >= 31 && total >= 183;
    if (met) {
      html += '<p class="state over">' + say("met", { year: year }) + "</p>";
      return html;
    }
    // Staying every day from the count date to the end of the year.
    var end = yearStart(year + 1) - 1, found = null, n0 = between(y0, asof - 1);
    for (var d = asof; d <= end; d++) {
      n0++;
      if (n0 >= 31 && n0 + d1 / 3 + d2 / 6 >= 183) { found = d; break; }
    }
    if (found === null) {
      html += '<p class="state">' + say("notMetPlain") + "</p>";
    } else if (total >= 183) {
      html += '<p class="state">' + say("short31", { year: year, n: 31 - d0 }) + "</p>";
    } else {
      var need = Math.max(31 - d0, Math.ceil(183 - total - 1e-9));
      html += '<p class="state">' + say("notMet", { year: year, n: need }) + "</p>";
    }
    html += "<p>" + (found !== null
      ? say("project", { start: show(asof), date: show(found) })
      : say("projectNone", { start: show(asof), year: year })) + "</p>";
    return html;
  }

  function update() {
    var asof = parse(asofInput.value);
    if (asof === null) { asof = today(); asofInput.value = iso(asof); }
    var days = presence(asof);
    if (!days) { result.innerHTML = '<p class="muted">' + t.empty + "</p>"; return; }
    result.innerHTML = cfg.type === "weighted" ? weighted(days, asof) : rolling(days, asof);
  }

  asofInput.value = iso(today());
  addTrip();
  root.querySelector(".add").addEventListener("click", function () {
    addTrip().querySelector(".from").focus();
    update();
  });
  root.addEventListener("input", update);
  root.addEventListener("change", update);
  update();
})();
