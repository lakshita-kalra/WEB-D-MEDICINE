// ============================================================
// STATE
// ============================================================
var state = {
  user:          null,
  medicines:     [],
  logs:          [],
  selectedColor: "blue",
  times:         ["08:00"],
  alarmsFired:   {},
  audioCtx:      null,
  alarmRunning:  false,
  calYear:       new Date().getFullYear(),
  calMonth:      new Date().getMonth(),
  calSelected:   null
};

// ============================================================
// AUDIO — unlocked on first user click
// ============================================================
document.addEventListener("click", function() {
  if (!state.audioCtx) {
    try { state.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e) { state.audioCtx = null; }
  }
  if (state.audioCtx && state.audioCtx.state === "suspended") {
    state.audioCtx.resume();
  }
}, { passive: true });

function beep() {
  if (!state.audioCtx || state.audioCtx.state !== "running") return;
  var ctx = state.audioCtx;
  var t   = ctx.currentTime;
  [[880, t, t+0.35], [1100, t+0.42, t+0.78]].forEach(function(c) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = c[0];
    g.gain.setValueAtTime(0.35, c[1]);
    g.gain.exponentialRampToValueAtTime(0.001, c[2]);
    o.start(c[1]); o.stop(c[2]);
  });
}

// ============================================================
// API
// ============================================================
function api(method, url, body) {
  return fetch(url, {
    method:  method,
    headers: { "Content-Type": "application/json" },
    body:    body ? JSON.stringify(body) : undefined
  })
  .then(function(r) { return r.json(); })
  .catch(function(e) { return { error: String(e) }; });
}

// ============================================================
// TOAST
// ============================================================
function toast(msg, type) {
  type = type || "success";
  var el = document.createElement("div");
  el.className = "toast toast-" + type;
  el.textContent = msg;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 3200);
}

// ============================================================
// NOTIFICATION BANNER
// ============================================================
function showBanner(msg) {
  var banner = document.getElementById("notif-banner");
  document.getElementById("notif-text").textContent = "Reminder: " + msg;
  banner.classList.remove("hidden");
  beep();
  if (window.Notification && Notification.permission === "granted") {
    new Notification("MedMinder Reminder", { body: msg });
  }
  setTimeout(function() { banner.classList.add("hidden"); }, 8000);
}

// ============================================================
// HELPERS
// ============================================================
function todayStr() {
  var d = new Date();
  return d.getFullYear() + "-"
    + String(d.getMonth()+1).padStart(2,"0") + "-"
    + String(d.getDate()).padStart(2,"0");
}

function dateStr(d) {
  return d.getFullYear() + "-"
    + String(d.getMonth()+1).padStart(2,"0") + "-"
    + String(d.getDate()).padStart(2,"0");
}

function fmt12(t) {
  var p = t.split(":"), h = parseInt(p[0]), m = p[1];
  return ((h+11)%12+1) + ":" + m + " " + (h>=12?"PM":"AM");
}

function isPast(timeStr) {
  var p = timeStr.split(":"), d = new Date();
  d.setHours(parseInt(p[0]), parseInt(p[1]), 0, 0);
  return new Date() > d;
}

function getStatus(medId, date, time) {
  for (var i = 0; i < state.logs.length; i++) {
    var l = state.logs[i];
    if (l.medicine_id === medId && l.date === date && l.time === time) return l.status;
  }
  return "pending";
}

var COLOR_SVG = {
  blue:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
  violet: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  teal:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  green:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
  orange: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/></svg>',
  red:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>'
};

// ============================================================
// ALARM CHECKER
// ============================================================
function checkAlarms() {
  if (!state.user) return;
  var now   = new Date();
  var today = todayStr();
  var cur   = String(now.getHours()).padStart(2,"0") + ":" + String(now.getMinutes()).padStart(2,"0");
  state.medicines.forEach(function(med) {
    if (!Array.isArray(med.times)) return;
    med.times.forEach(function(t) {
      if (t !== cur) return;
      if (getStatus(med.id, today, t) !== "pending") return;
      var key = med.id + "-" + today + "-" + t;
      if (state.alarmsFired[key]) return;
      state.alarmsFired[key] = true;
      showBanner("Take " + med.name + " \u2014 " + med.dosage + " at " + fmt12(t));
    });
  });
  Object.keys(state.alarmsFired).forEach(function(k) {
    if (k.indexOf(today) === -1) delete state.alarmsFired[k];
  });
}

function startAlarms() {
  if (state.alarmRunning) return;
  state.alarmRunning = true;
  checkAlarms();
  setInterval(checkAlarms, 30000);
}

// ============================================================
// INIT
// ============================================================
function init() {
  api("GET", "/api/me").then(function(res) {
    if (res.user) {
      state.user = res.user;
      loadData().then(showApp);
    } else {
      showAuth();
    }
  });
}

function loadData() {
  return Promise.all([api("GET","/api/medicines"), api("GET","/api/logs")])
    .then(function(res) {
      state.medicines = Array.isArray(res[0]) ? res[0] : [];
      state.logs      = Array.isArray(res[1]) ? res[1] : [];
    });
}

// ============================================================
// AUTH SCREEN
// ============================================================
function showAuth() {
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("app-screen").classList.add("hidden");
}

function showLoginBox() {
  document.getElementById("login-box").classList.remove("hidden");
  document.getElementById("register-box").classList.add("hidden");
  document.getElementById("login-error").classList.add("hidden");
}

function showRegisterBox() {
  document.getElementById("register-box").classList.remove("hidden");
  document.getElementById("login-box").classList.add("hidden");
  document.getElementById("register-error").classList.add("hidden");
}

function doLogin() {
  var email  = document.getElementById("login-email").value.trim();
  var passwd = document.getElementById("login-password").value;
  var errEl  = document.getElementById("login-error");
  errEl.classList.add("hidden");
  if (!email || !passwd) { errEl.textContent = "Please fill in all fields."; errEl.classList.remove("hidden"); return; }
  api("POST", "/api/login", { email: email, password: passwd }).then(function(res) {
    if (res.error) { errEl.textContent = res.error; errEl.classList.remove("hidden"); return; }
    state.user = res;
    loadData().then(function() { showApp(); toast("Welcome back, " + res.name + "!"); });
  });
}

function doRegister() {
  var name   = document.getElementById("reg-name").value.trim();
  var email  = document.getElementById("reg-email").value.trim();
  var passwd = document.getElementById("reg-password").value;
  var errEl  = document.getElementById("register-error");
  errEl.classList.add("hidden");
  if (!name || !email || !passwd) { errEl.textContent = "Please fill in all fields."; errEl.classList.remove("hidden"); return; }
  api("POST", "/api/register", { name: name, email: email, password: passwd }).then(function(res) {
    if (res.error) { errEl.textContent = res.error; errEl.classList.remove("hidden"); return; }
    state.user = res;
    loadData().then(function() { showApp(); toast("Welcome to MedMinder, " + res.name + "!"); });
  });
}

function doLogout() {
  api("POST", "/api/logout").then(function() {
    state.user = null; state.medicines = []; state.logs = [];
    showAuth();
  });
}

// ============================================================
// APP SCREEN
// ============================================================
function showApp() {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");
  if (window.Notification && Notification.permission === "default") Notification.requestPermission();
  startAlarms();
  renderAll();
}

function renderAll() {
  if (!state.user) return;
  document.getElementById("header-avatar").textContent   = state.user.name[0].toUpperCase();
  document.getElementById("header-username").textContent = state.user.name;
  document.getElementById("header-email").textContent    = state.user.email;
  var h = new Date().getHours();
  document.getElementById("greeting-time").textContent =
    h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  document.getElementById("greeting-name").textContent = state.user.name.split(" ")[0];
  renderStats();
  renderSchedule();
  renderHistory();
}

// ============================================================
// STATS
// ============================================================
function renderStats() {
  var today  = todayStr();
  var todayLogs = state.logs.filter(function(l) { return l.date === today; });
  var taken  = todayLogs.filter(function(l) { return l.status === "taken"; }).length;
  var missed = todayLogs.filter(function(l) { return l.status === "missed"; }).length;
  var allTaken  = state.logs.filter(function(l) { return l.status === "taken"; }).length;
  var allMissed = state.logs.filter(function(l) { return l.status === "missed"; }).length;
  var total = allTaken + allMissed;
  document.getElementById("stat-meds").textContent      = state.medicines.length;
  document.getElementById("stat-taken").textContent     = taken;
  document.getElementById("stat-missed").textContent    = missed;
  document.getElementById("stat-adherence").textContent = total ? Math.round(allTaken/total*100)+"%" : "0%";
}

// ============================================================
// SCHEDULE (TODAY)
// ============================================================
function renderSchedule() {
  var today = todayStr();
  var slots = [];
  state.medicines.forEach(function(med) {
    if (!Array.isArray(med.times)) return;
    med.times.forEach(function(t) { slots.push({ med: med, time: t }); });
  });
  slots.sort(function(a,b) { return a.time.localeCompare(b.time); });

  var pending = slots.filter(function(s) { return getStatus(s.med.id, today, s.time) === "pending"; }).length;
  document.getElementById("greeting-sub").textContent =
    pending > 0 ? pending + " dose"+(pending>1?"s":"")+" pending today"
    : slots.length > 0 ? "All doses logged — great job!"
    : "No medicines yet";

  var list = document.getElementById("schedule-list");
  if (!slots.length) {
    list.innerHTML = '<div class="empty-box"><h3>No doses scheduled</h3><p>Click "+ Add Medicine" to create your first reminder.</p></div>';
    return;
  }
  list.innerHTML = slots.map(function(s, idx) {
    return buildDoseCard(s.med, s.time, today, idx);
  }).join("");
  attachDoseEvents(list);
}

function buildDoseCard(med, time, date, idx) {
  var status  = getStatus(med.id, date, time);
  var overdue = (status === "pending" && isPast(time) && date === todayStr());
  var color   = med.color || "blue";
  var stCls   = status === "taken" ? "st-taken" : status === "missed" ? "st-missed" : overdue ? "st-overdue" : "";
  var badge   = status === "taken"  ? '<span class="dose-badge b-taken">Taken</span>'
              : status === "missed" ? '<span class="dose-badge b-missed">Missed</span>'
              : overdue             ? '<span class="dose-badge b-overdue">Overdue</span>' : "";
  var nameCls = status === "taken" ? "dose-name crossed" : "dose-name";
  var actions = status === "pending"
    ? '<button class="take-btn" data-id="'+med.id+'" data-time="'+time+'" data-date="'+date+'" data-act="taken">Take</button>'
      + '<button class="miss-btn" data-id="'+med.id+'" data-time="'+time+'" data-date="'+date+'" data-act="missed" title="Mark missed">'
      + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
    : '<button class="undo-btn" data-id="'+med.id+'" data-time="'+time+'" data-date="'+date+'" data-act="'+(status==="taken"?"missed":"taken")+'">Undo</button>';
  return '<div class="dose-card c-'+color+' '+stCls+'" style="animation-delay:'+(idx*0.04)+'s">'
    + '<div class="dose-icon c-'+color+'">'+(COLOR_SVG[color]||COLOR_SVG.blue)+'</div>'
    + '<div class="dose-info">'
    +   '<div class="dose-name-row"><span class="'+nameCls+'">'+med.name+'</span>'+badge+'</div>'
    +   '<div class="dose-meta">'+fmt12(time)+' &bull; '+med.dosage+'</div>'
    +   (med.notes ? '<div class="dose-note">'+med.notes+'</div>' : '')
    + '</div>'
    + '<div class="dose-actions">'+actions
    + '<button class="del-btn" data-del="'+med.id+'" title="Delete">'
    + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>'
    + '</button></div>'
    + '</div>';
}

function attachDoseEvents(container) {
  container.querySelectorAll("[data-act]").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      markDose(btn.dataset.id, btn.dataset.time, btn.dataset.date || todayStr(), btn.dataset.act);
    });
  });
  container.querySelectorAll("[data-del]").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      deleteMed(btn.dataset.del);
    });
  });
}

function markDose(medId, time, date, status) {
  api("POST", "/api/logs", { medicine_id: medId, date: date, time: time, status: status })
    .then(function(log) {
      if (log.error) { toast("Error: "+log.error, "error"); return; }
      var key = medId+"-"+date+"-"+time;
      state.logs = state.logs.filter(function(l) { return l.id !== key; });
      state.logs.push(log);
      renderStats();
      renderSchedule();
      renderHistory();
      if (state.calSelected === date) renderCalDayDetail(date);
      toast(status === "taken" ? "Dose marked as taken." : "Dose marked as missed.");
    });
}

function deleteMed(medId) {
  if (!confirm("Delete this medicine and all its logs?")) return;
  api("DELETE", "/api/medicines/"+medId).then(function() {
    state.medicines = state.medicines.filter(function(m) { return m.id !== medId; });
    state.logs      = state.logs.filter(function(l) { return l.medicine_id !== medId; });
    renderStats(); renderSchedule(); renderHistory(); renderCalendar();
    toast("Medicine deleted.");
  });
}

// ============================================================
// HISTORY
// ============================================================
function renderHistory() {
  var el     = document.getElementById("history-list");
  var medMap = {};
  state.medicines.forEach(function(m) { medMap[m.id] = m; });
  var sorted = state.logs.slice()
    .sort(function(a,b) { return (b.logged_at||0)-(a.logged_at||0); })
    .slice(0, 80);
  if (!sorted.length) {
    el.innerHTML = '<div class="empty-box"><p style="color:var(--text3);font-size:.85rem">No history yet.</p></div>';
    return;
  }
  var grouped = {};
  sorted.forEach(function(l) { (grouped[l.date]||(grouped[l.date]=[])).push(l); });
  el.innerHTML = Object.keys(grouped).sort(function(a,b){return b.localeCompare(a);}).map(function(date) {
    var label = new Date(date+"T00:00:00").toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});
    var rows  = grouped[date].map(function(l) {
      var name = (medMap[l.medicine_id]||{}).name || "Deleted medicine";
      return '<div class="history-row">'
        +'<div class="h-dot '+l.status+'">'+(l.status==="taken"?"T":"M")+'</div>'
        +'<span class="h-name">'+name+'</span>'
        +'<span class="h-time">'+fmt12(l.time)+'</span>'
        +'</div>';
    }).join("");
    return '<div class="history-group"><div class="history-date">'+label+'</div>'+rows+'</div>';
  }).join("");
}

// ============================================================
// CALENDAR
// ============================================================
function renderCalendar() {
  var year  = state.calYear;
  var month = state.calMonth;
  var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  document.getElementById("cal-month-label").textContent = months[month] + " " + year;

  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month+1, 0).getDate();
  var today = todayStr();

  var html = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(function(d) {
    return '<div class="cal-weekday">'+d+'</div>';
  }).join("");

  for (var i = 0; i < firstDay; i++) {
    html += '<div class="cal-day empty"></div>';
  }

  for (var day = 1; day <= daysInMonth; day++) {
    var ds   = year+"-"+String(month+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");
    var dayLogs = state.logs.filter(function(l) { return l.date === ds; });
    var takenC  = dayLogs.filter(function(l) { return l.status==="taken"; }).length;
    var missedC = dayLogs.filter(function(l) { return l.status==="missed"; }).length;

    var cls = "cal-day";
    if (ds === today)                   cls += " today";
    if (ds === state.calSelected)       cls += " selected";
    if (takenC > 0 && missedC === 0)    cls += " all-taken";
    if (missedC > 0 && takenC > 0)      cls += " some-missed";
    if (missedC > 0 && takenC === 0 && ds < today) cls += " all-missed";

    var dots = "";
    if (takenC > 0)  dots += '<div class="cal-dot taken"></div>';
    if (missedC > 0) dots += '<div class="cal-dot missed"></div>';

    html += '<div class="'+cls+'" data-date="'+ds+'">'
      + '<div class="cal-day-num">'+day+'</div>'
      + (dots ? '<div class="cal-dot-row">'+dots+'</div>' : '')
      + '</div>';
  }

  var grid = document.getElementById("calendar-grid");
  grid.innerHTML = html;
  grid.querySelectorAll(".cal-day:not(.empty)").forEach(function(cell) {
    cell.addEventListener("click", function() {
      var d = cell.dataset.date;
      state.calSelected = d;
      renderCalendar();
      renderCalDayDetail(d);
    });
  });

  if (state.calSelected) renderCalDayDetail(state.calSelected);
}

function renderCalDayDetail(dateStr) {
  var detail     = document.getElementById("cal-day-detail");
  var label      = document.getElementById("cal-detail-label");
  var list       = document.getElementById("cal-detail-list");
  var d          = new Date(dateStr+"T00:00:00");
  var labelText  = d.toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"});
  label.textContent = labelText;
  detail.classList.remove("hidden");

  if (!state.medicines.length) {
    list.innerHTML = '<p style="color:var(--text3);font-size:.84rem">No medicines added yet.</p>';
    return;
  }
  var slots = [];
  state.medicines.forEach(function(med) {
    if (!Array.isArray(med.times)) return;
    med.times.forEach(function(t) { slots.push({ med: med, time: t }); });
  });
  slots.sort(function(a,b) { return a.time.localeCompare(b.time); });
  list.innerHTML = slots.map(function(s, idx) {
    return buildDoseCard(s.med, s.time, dateStr, idx);
  }).join("");
  attachDoseEvents(list);
}

// ============================================================
// ANALYTICS
// ============================================================
function renderAnalytics() {
  api("GET", "/api/analytics").then(function(data) {
    if (data.error) { toast("Could not load analytics.", "error"); return; }
    document.getElementById("an-adherence").textContent = data.adherence + "%";
    document.getElementById("an-taken").textContent     = data.taken_total;
    document.getElementById("an-missed").textContent    = data.missed_total;
    document.getElementById("an-streak").textContent    = data.streak + " day" + (data.streak !== 1 ? "s" : "");
    renderBarChart(data.weekly);
    renderMedBreakdown(data.med_stats);
  });
}

function renderBarChart(weekly) {
  var maxVal = 0;
  weekly.forEach(function(d) { maxVal = Math.max(maxVal, d.taken + d.missed); });
  maxVal = maxVal || 1;

  var html = weekly.map(function(d) {
    var takenH  = Math.round((d.taken  / maxVal) * 110);
    var missedH = Math.round((d.missed / maxVal) * 110);
    return '<div class="bar-group">'
      + '<div class="bar-stack">'
      + '<div class="bar-taken"  style="height:'+takenH+'px"></div>'
      + '<div class="bar-missed" style="height:'+missedH+'px"></div>'
      + '</div>'
      + '<div class="bar-label">'+d.label+'</div>'
      + '</div>';
  }).join("");
  document.getElementById("bar-chart").innerHTML = html;
}

function renderMedBreakdown(medStats) {
  var colorHex = { blue:"#3b82f6", violet:"#7c3aed", teal:"#0891b2", green:"#22c55e", orange:"#d97706", red:"#dc2626" };
  var el = document.getElementById("med-breakdown");
  if (!medStats.length) {
    el.innerHTML = '<p style="color:var(--text3);font-size:.85rem">No data yet.</p>';
    return;
  }
  el.innerHTML = medStats.map(function(m) {
    var hex  = colorHex[m.color] || colorHex.blue;
    var pillCls = m.adherence >= 80 ? "high" : m.adherence >= 50 ? "mid" : "low";
    return '<div class="med-breakdown-card">'
      + '<div class="med-color-bar" style="background:'+hex+'"></div>'
      + '<div class="med-bd-info">'
      +   '<div class="med-bd-name">'+m.name+'</div>'
      +   '<div class="med-bd-sub">Taken: '+m.taken+' &bull; Missed: '+m.missed+'</div>'
      + '</div>'
      + '<div class="adherence-pill '+pillCls+'">'+m.adherence+'%</div>'
      + '</div>';
  }).join("");
}

// ============================================================
// TABS
// ============================================================
var TABS = ["today","calendar","analytics","history"];

function switchTab(tab) {
  TABS.forEach(function(t) {
    document.getElementById("tab-"+t).classList.toggle("hidden", t !== tab);
    var btn = document.getElementById("nav-"+t);
    if (btn) btn.classList.toggle("active", t === tab);
  });
  if (tab === "calendar") {
    state.calSelected = todayStr();
    renderCalendar();
  }
  if (tab === "analytics") renderAnalytics();
}

// ============================================================
// MODAL
// ============================================================
function openModal() {
  state.selectedColor = "blue";
  state.times         = ["08:00"];
  document.getElementById("med-name").value   = "";
  document.getElementById("med-dosage").value = "";
  document.getElementById("med-notes").value  = "";
  document.querySelectorAll(".color-dot").forEach(function(d) {
    d.classList.toggle("selected", d.dataset.color === "blue");
  });
  renderTimeInputs();
  document.getElementById("add-modal").classList.remove("hidden");
  setTimeout(function() { document.getElementById("med-name").focus(); }, 80);
}

function closeModal() {
  document.getElementById("add-modal").classList.add("hidden");
}

function renderTimeInputs() {
  var c = document.getElementById("times-list");
  c.innerHTML = state.times.map(function(t, i) {
    return '<div class="time-row">'
      + '<input type="time" class="form-input time-val" data-idx="'+i+'" value="'+t+'"/>'
      + (state.times.length > 1
          ? '<button class="rm-time-btn" data-ridx="'+i+'">'
            + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
            + '</button>'
          : '')
      + '</div>';
  }).join("");
  c.querySelectorAll(".time-val").forEach(function(inp) {
    var idx = parseInt(inp.dataset.idx);
    inp.addEventListener("change", function() { state.times[idx] = inp.value; });
    inp.addEventListener("input",  function() { state.times[idx] = inp.value; });
  });
  c.querySelectorAll(".rm-time-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      state.times.splice(parseInt(btn.dataset.ridx), 1);
      renderTimeInputs();
    });
  });
}

function submitMedicine() {
  var name   = document.getElementById("med-name").value.trim();
  var dosage = document.getElementById("med-dosage").value.trim();
  var notes  = document.getElementById("med-notes").value.trim();
  var times  = state.times.filter(function(t) { return t && t.length; });
  if (!name)         { toast("Medicine name is required.", "error"); return; }
  if (!dosage)       { toast("Dosage is required.", "error"); return; }
  if (!times.length) { toast("Add at least one reminder time.", "error"); return; }
  api("POST", "/api/medicines", { name:name, dosage:dosage, notes:notes, times:times, color:state.selectedColor })
    .then(function(med) {
      if (med.error) { toast("Error: "+med.error, "error"); return; }
      if (!Array.isArray(med.times)) { toast("Server error.", "error"); return; }
      state.medicines.push(med);
      closeModal();
      renderStats(); renderSchedule();
      toast(name + " added — " + med.times.length + " reminder"+(med.times.length>1?"s":"")+".");
    });
}

// ============================================================
// EVENT LISTENERS
// ============================================================
document.addEventListener("DOMContentLoaded", function() {

  // Auth
  document.getElementById("login-btn").addEventListener("click", doLogin);
  document.getElementById("register-btn").addEventListener("click", doRegister);
  document.getElementById("go-register-btn").addEventListener("click", showRegisterBox);
  document.getElementById("go-login-btn").addEventListener("click", showLoginBox);
  document.getElementById("login-email").addEventListener("keydown", function(e) { if (e.key==="Enter") doLogin(); });
  document.getElementById("login-password").addEventListener("keydown", function(e) { if (e.key==="Enter") doLogin(); });
  document.getElementById("reg-password").addEventListener("keydown", function(e) { if (e.key==="Enter") doRegister(); });

  // Sidebar
  TABS.forEach(function(tab) {
    var btn = document.getElementById("nav-"+tab);
    if (btn) btn.addEventListener("click", function() { switchTab(tab); });
  });
  document.getElementById("logout-btn").addEventListener("click", doLogout);

  // Modal
  document.getElementById("open-modal-btn").addEventListener("click", openModal);
  document.getElementById("close-modal-btn").addEventListener("click", closeModal);
  document.getElementById("cancel-modal-btn").addEventListener("click", closeModal);
  document.getElementById("submit-medicine-btn").addEventListener("click", submitMedicine);
  document.getElementById("add-modal").addEventListener("click", function(e) { if (e.target===this) closeModal(); });
  document.getElementById("add-time-btn").addEventListener("click", function() {
    state.times.push("12:00"); renderTimeInputs();
  });

  // Color picker
  document.getElementById("color-picker").addEventListener("click", function(e) {
    var dot = e.target.closest(".color-dot");
    if (!dot) return;
    state.selectedColor = dot.dataset.color;
    document.querySelectorAll(".color-dot").forEach(function(d) { d.classList.remove("selected"); });
    dot.classList.add("selected");
  });

  // Calendar nav
  document.getElementById("cal-prev").addEventListener("click", function() {
    state.calMonth--;
    if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
    renderCalendar();
  });
  document.getElementById("cal-next").addEventListener("click", function() {
    state.calMonth++;
    if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
    renderCalendar();
  });

  // Notification banner close
  document.getElementById("notif-close").addEventListener("click", function() {
    document.getElementById("notif-banner").classList.add("hidden");
  });

  init();
});
