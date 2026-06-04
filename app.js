(() => {
  const STORAGE_KEY = "lifeAnalyticsDashboardV1";
  const QUOTES = [
    "Small progress each day adds up.",
    "Consistency compounds into excellence.",
    "Own your hours, own your life.",
    "Track what matters most."
  ];
  const CATEGORIES = [
    "Sleep", "Mobile Usage", "Study", "Work", "Exercise", "Transportation", "Eating", "Reading",
    "Social Media", "Entertainment", "Family Time", "Religious Activities", "Meetings", "Coding", "Gaming", "Walking", "Shopping", "Custom"
  ];
  const PRODUCTIVE = new Set(["Study", "Work", "Exercise", "Reading", "Coding", "Religious Activities"]);
  const DISTRACTION = new Set(["Mobile Usage", "Social Media", "Gaming", "Entertainment"]);

  const fmtDate = (d) => new Date(d).toISOString().slice(0, 10);
  const today = fmtDate(new Date());

  const defaultState = {
    selectedDate: today,
    settings: { theme: "dark" },
    records: {},
    goals: [],
    moods: {},
    achievements: [],
    backups: []
  };

  let state = loadState();
  let charts = {};
  let replayTimer;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return saved ? { ...defaultState, ...saved } : structuredClone(defaultState);
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  const $ = (id) => document.getElementById(id);

  function init() {
    renderCategoryOptions();
    bindEvents();
    applyTheme();
    $("selectedDate").value = state.selectedDate;
    renderAll();
    setInterval(updateClockWidget, 1000);
  }

  function bindEvents() {
    document.querySelectorAll(".nav-link").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-link").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
        btn.classList.add("active");
        $(btn.dataset.target).classList.add("active");
      });
    });

    $("themeToggle").addEventListener("click", () => {
      state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
      saveState();
      applyTheme();
    });

    $("selectedDate").addEventListener("change", (e) => {
      state.selectedDate = e.target.value;
      saveState();
      renderAll();
    });
    $("prevDayBtn").addEventListener("click", () => shiftDate(-1));
    $("nextDayBtn").addEventListener("click", () => shiftDate(1));

    $("activityForm").addEventListener("submit", onSaveActivity);
    ["searchActivity", "filterMonth", "filterYear", "filterCategory", "filterScore"].forEach((id) => {
      $(id).addEventListener("input", renderActivitiesList);
    });

    $("goalForm").addEventListener("submit", onSaveGoal);
    $("saveMoodBtn").addEventListener("click", onSaveMood);

    $("startReplayBtn").addEventListener("click", startReplay);
    $("downloadReportBtn").addEventListener("click", downloadReport);

    $("exportJsonBtn").addEventListener("click", exportJSON);
    $("exportCsvBtn").addEventListener("click", exportCSV);
    $("backupBtn").addEventListener("click", backupData);
    $("restoreBtn").addEventListener("click", restoreData);
    $("importJsonInput").addEventListener("change", importJSON);
  }

  function renderCategoryOptions() {
    ["activityCategory", "filterCategory"].forEach((id) => {
      const isFilter = id === "filterCategory";
      $(id).innerHTML = (isFilter ? '<option value="">All Categories</option>' : "") +
        CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("");
    });
  }

  function getDayActivities(date = state.selectedDate) {
    return [...(state.records[date] || [])].sort((a, b) => a.start.localeCompare(b.start));
  }

  function toHours(start, end) {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    let s = sh * 60 + sm;
    let e = eh * 60 + em;
    if (e < s) e += 24 * 60;
    return Number(((e - s) / 60).toFixed(2));
  }

  function calcDayTotal(activities) {
    return Number(activities.reduce((acc, a) => acc + (a.duration || 0), 0).toFixed(2));
  }

  function onSaveActivity(e) {
    e.preventDefault();
    const id = $("activityId").value || crypto.randomUUID();
    const name = $("activityName").value.trim();
    const category = $("activityCategory").value;
    const start = $("activityStart").value;
    const end = $("activityEnd").value;
    const productive = $("productive").checked;
    if (!name || !start || !end) return;

    const duration = toHours(start, end);
    const activities = getDayActivities();
    const existingIndex = activities.findIndex((a) => a.id === id);
    if (existingIndex >= 0) activities.splice(existingIndex, 1);

    activities.push({ id, name, category, start, end, duration, productive });
    const total = calcDayTotal(activities);
    if (total > 24) {
      setValidation(`Cannot exceed 24 hours. Current total would be ${total}h`, true);
      return;
    }

    state.records[state.selectedDate] = activities;
    saveState();
    e.target.reset();
    $("activityId").value = "";
    setValidation(total === 24 ? "Perfect day logged: 24h total." : `Saved. ${Number((24 - total).toFixed(2))}h remaining.`, total !== 24);
    updateAchievements();
    renderAll();
  }

  function editActivity(id) {
    const item = getDayActivities().find((a) => a.id === id);
    if (!item) return;
    $("activityId").value = item.id;
    $("activityName").value = item.name;
    $("activityCategory").value = item.category;
    $("activityStart").value = item.start;
    $("activityEnd").value = item.end;
    $("productive").checked = item.productive;
    $("saveActivityBtn").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function deleteActivity(id) {
    state.records[state.selectedDate] = getDayActivities().filter((a) => a.id !== id);
    saveState();
    renderAll();
  }

  function dayProductivityScore(date) {
    const acts = getDayActivities(date);
    const productiveHours = acts.filter((a) => a.productive || PRODUCTIVE.has(a.category)).reduce((s, a) => s + a.duration, 0);
    return Math.min(100, Math.round((productiveHours / 12) * 100));
  }

  function renderActivitiesList() {
    const q = $("searchActivity").value.toLowerCase();
    const month = $("filterMonth").value;
    const year = $("filterYear").value;
    const cat = $("filterCategory").value;
    const minScore = Number($("filterScore").value || 0);
    const date = state.selectedDate;

    const activities = getDayActivities().filter((a) => {
      if (q && !`${a.name} ${a.category}`.toLowerCase().includes(q)) return false;
      if (cat && a.category !== cat) return false;
      if (month && !date.startsWith(month)) return false;
      if (year && !date.startsWith(String(year))) return false;
      if (minScore && dayProductivityScore(date) < minScore) return false;
      return true;
    });

    const total = calcDayTotal(getDayActivities());
    const rem = Number((24 - total).toFixed(2));
    setValidation(total === 24 ? "24-hour validation complete." : `Total: ${total}h. Remaining: ${rem}h`, total !== 24);

    const container = $("activitiesList");
    container.textContent = "";
    if (!activities.length) {
      const empty = document.createElement("p");
      empty.textContent = "No activities found for selected filters/date.";
      container.appendChild(empty);
      return;
    }

    activities.forEach((a) => {
      const row = document.createElement("div");
      row.className = "item";
      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = a.name;
      info.appendChild(title);
      info.append(` (${a.category})`);
      info.appendChild(document.createElement("br"));
      info.append(`${a.start} → ${a.end} (${a.duration}h)`);
      const editBtn = document.createElement("button");
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => editActivity(a.id));
      const delBtn = document.createElement("button");
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => deleteActivity(a.id));
      row.append(info, editBtn, delBtn);
      container.appendChild(row);
    });
  }

  function renderWidgets() {
    const date = state.selectedDate;
    const acts = getDayActivities(date);
    const total = calcDayTotal(acts);
    const week = rangeFrom(date, "weekly");
    const month = rangeFrom(date, "monthly");
    const weekHours = sumRange(week).toFixed(2);
    const monthHours = sumRange(month).toFixed(2);
    const quote = QUOTES[Math.abs(hashCode(date)) % QUOTES.length];

    $("widgets").innerHTML = `
      <div class="glass card"><h4>Daily Progress</h4><p>${total.toFixed(2)} / 24 hours</p></div>
      <div class="glass card"><h4>Weekly Progress</h4><p>${weekHours} tracked hours</p></div>
      <div class="glass card"><h4>Monthly Progress</h4><p>${monthHours} tracked hours</p></div>
      <div class="glass card"><h4>Productivity Status</h4><p>${dayProductivityScore(date)} / 100</p></div>
      <div class="glass card"><h4>Motivational Quote</h4><p>${quote}</p></div>
    `;
  }

  function updateClockWidget() {
    const now = new Date();
    $("currentDateLabel").textContent = now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    $("currentTimeLabel").textContent = now.toLocaleTimeString();
  }

  function shiftDate(byDays) {
    const d = new Date(state.selectedDate);
    d.setDate(d.getDate() + byDays);
    state.selectedDate = fmtDate(d);
    $("selectedDate").value = state.selectedDate;
    saveState();
    renderAll();
  }

  function applyTheme() {
    document.documentElement.classList.toggle("light", state.settings.theme === "light");
  }

  function setValidation(message, warn) {
    const el = $("validationMessage");
    el.textContent = message;
    el.style.color = warn ? "var(--danger)" : "var(--success)";
  }

  function onSaveGoal(e) {
    e.preventDefault();
    const goal = {
      id: crypto.randomUUID(),
      name: $("goalName").value.trim(),
      activity: $("goalActivity").value.trim(),
      target: Number($("goalTarget").value)
    };
    if (!goal.name || !goal.activity || !goal.target) return;
    state.goals.push(goal);
    saveState();
    e.target.reset();
    renderGoals();
  }

  function removeGoal(id) {
    state.goals = state.goals.filter((g) => g.id !== id);
    saveState();
    renderGoals();
  }

  function goalProgress(goal, date = state.selectedDate) {
    const done = getDayActivities(date).filter((a) => `${a.name} ${a.category}`.toLowerCase().includes(goal.activity.toLowerCase())).reduce((s, a) => s + a.duration, 0);
    const pct = Math.min(100, Math.round((done / goal.target) * 100));
    const streak = computeGoalStreak(goal);
    return { done: Number(done.toFixed(2)), pct, streak };
  }

  function computeGoalStreak(goal) {
    let streak = 0;
    const d = new Date(state.selectedDate);
    for (let i = 0; i < 365; i += 1) {
      const date = fmtDate(d);
      const done = getDayActivities(date).filter((a) => `${a.name} ${a.category}`.toLowerCase().includes(goal.activity.toLowerCase())).reduce((s, a) => s + a.duration, 0);
      if (done >= goal.target) streak += 1;
      else break;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  function renderGoals() {
    const container = $("goalList");
    container.textContent = "";
    if (!state.goals.length) {
      const empty = document.createElement("p");
      empty.textContent = "No goals added yet.";
      container.appendChild(empty);
      return;
    }
    state.goals.forEach((goal) => {
      const p = goalProgress(goal);
      const row = document.createElement("div");
      row.className = "item";
      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = goal.name;
      info.appendChild(name);
      info.appendChild(document.createElement("br"));
      info.append(`${p.done}h / ${goal.target}h (${p.pct}%), streak: ${p.streak}`);
      const delBtn = document.createElement("button");
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => removeGoal(goal.id));
      row.append(info, delBtn);
      container.appendChild(row);
    });
  }

  function onSaveMood() {
    state.moods[state.selectedDate] = $("moodSelect").value;
    saveState();
    renderInsights();
  }

  function renderInsights() {
    const date = state.selectedDate;
    const prev = fmtDate(new Date(new Date(date).setDate(new Date(date).getDate() - 1)));
    const currentActs = getDayActivities(date);
    const prevActs = getDayActivities(prev);
    const curStudy = sumCategory(currentActs, "Study");
    const prevStudy = sumCategory(prevActs, "Study");
    const curMobile = sumCategory(currentActs, "Mobile Usage") + sumCategory(currentActs, "Social Media");
    const prevMobile = sumCategory(prevActs, "Mobile Usage") + sumCategory(prevActs, "Social Media");

    const lines = [];
    if (prevStudy > 0) {
      const delta = (((curStudy - prevStudy) / prevStudy) * 100).toFixed(0);
      lines.push(`Your study time changed by ${delta}% vs yesterday.`);
    }
    lines.push(curMobile < prevMobile ? "Great job, your phone/social time decreased vs yesterday." : "Your phone/social time increased vs yesterday.");
    lines.push(`You are most productive on ${mostProductiveWeekday()}.`);
    lines.push(`This month productivity average: ${avgProductivity("monthly")} / 100.`);

    $("insightList").innerHTML = lines.map((l) => `<li>${escapeHTML(l)}</li>`).join("");

    const mood = state.moods[date] || "not set";
    const corr = moodProductivityCorrelation();
    $("moodInfo").textContent = `Today's mood: ${mood}. Mood/productivity trend: ${corr}`;

    renderAchievements();
    renderReportPreview();
  }

  function renderAchievements() {
    const all = new Set(state.achievements);
    if (studyStreak() >= 7) all.add("7-Day Study Streak");
    if (productiveStreak() >= 30) all.add("30-Day Productivity Streak");
    if (earlySleepCount() >= 10) all.add("Early Sleeper");
    if (digitalMinimalistCount() >= 14) all.add("Digital Minimalist");
    state.achievements = [...all];
    saveState();
    $("achievementList").innerHTML = state.achievements.length ? state.achievements.map((a) => `<span class="badge">🏅 ${escapeHTML(a)}</span>`).join(" ") : "<p>No achievements yet.</p>";
  }

  function updateAchievements() {
    renderAchievements();
  }

  function mostProductiveWeekday() {
    const map = {};
    Object.keys(state.records).forEach((date) => {
      const day = new Date(date).toLocaleDateString(undefined, { weekday: "long" });
      map[day] = (map[day] || 0) + dayProductivityScore(date);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";
  }

  function avgProductivity(range) {
    const days = rangeFrom(state.selectedDate, range);
    if (!days.length) return 0;
    const val = days.reduce((s, d) => s + dayProductivityScore(d), 0) / days.length;
    return Math.round(val);
  }

  function renderScoreCircles() {
    const scores = {
      Productivity: dayProductivityScore(state.selectedDate),
      Health: scoreHealth(state.selectedDate),
      Learning: scoreLearning(state.selectedDate),
      "Digital Wellness": scoreDigitalWellness(state.selectedDate),
      Consistency: scoreConsistency(state.selectedDate)
    };
    $("scoreCircles").innerHTML = Object.entries(scores).map(([k, v]) =>
      `<div><div class="score-circle" style="--value:${v}">${v}</div><small>${k}</small></div>`).join("");
  }

  function scoreHealth(date) {
    const acts = getDayActivities(date);
    const sleep = sumCategory(acts, "Sleep");
    const ex = sumCategory(acts, "Exercise") + sumCategory(acts, "Walking");
    return clamp(Math.round((Math.min(sleep, 8) / 8) * 60 + Math.min(ex, 2) / 2 * 40));
  }
  function scoreLearning(date) {
    const acts = getDayActivities(date);
    const learning = sumCategory(acts, "Study") + sumCategory(acts, "Reading") + sumCategory(acts, "Coding");
    return clamp(Math.round((learning / 8) * 100));
  }
  function scoreDigitalWellness(date) {
    const acts = getDayActivities(date);
    const screen = sumCategory(acts, "Mobile Usage") + sumCategory(acts, "Social Media") + sumCategory(acts, "Gaming");
    return clamp(Math.round(100 - (screen / 8) * 100));
  }
  function scoreConsistency(date) {
    const total = calcDayTotal(getDayActivities(date));
    const streak = productiveStreak();
    return clamp(Math.round((Math.min(total, 24) / 24) * 60 + Math.min(streak, 14) / 14 * 40));
  }

  function renderHabitStats() {
    const stats = [
      ["Average sleep hours", averageCategory("Sleep")],
      ["Average screen time", averageCategories(["Mobile Usage", "Social Media", "Gaming"])],
      ["Average study hours", averageCategory("Study")],
      ["Average exercise hours", averageCategories(["Exercise", "Walking"])],
      ["Most productive day", mostProductiveWeekday()],
      ["Most productive month", mostProductiveMonth()],
      ["Longest study streak", studyStreak()],
      ["Longest exercise streak", exerciseStreak()],
      ["Longest productivity streak", productiveStreak()]
    ];
    $("habitStats").innerHTML = stats.map(([k, v]) => `<li>${k}: <strong>${v}</strong></li>`).join("");
  }

  function mostProductiveMonth() {
    const byMonth = {};
    Object.keys(state.records).forEach((d) => {
      const m = d.slice(0, 7);
      byMonth[m] = (byMonth[m] || 0) + dayProductivityScore(d);
    });
    return Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";
  }

  function streakByCategory(categories, minHours = 0.5) {
    let best = 0;
    let run = 0;
    const dates = Object.keys(state.records).sort();
    dates.forEach((d) => {
      const hours = getDayActivities(d).filter((a) => categories.includes(a.category)).reduce((s, a) => s + a.duration, 0);
      if (hours >= minHours) run += 1;
      else run = 0;
      best = Math.max(best, run);
    });
    return best;
  }
  const studyStreak = () => streakByCategory(["Study"]);
  const exerciseStreak = () => streakByCategory(["Exercise", "Walking"]);
  const productiveStreak = () => {
    let run = 0;
    let best = 0;
    const dates = Object.keys(state.records).sort();
    dates.forEach((d) => {
      const s = dayProductivityScore(d);
      if (s >= 60) run += 1;
      else run = 0;
      best = Math.max(best, run);
    });
    return best;
  };

  function earlySleepCount() {
    return Object.values(state.records).filter((acts) => acts.some((a) => a.category === "Sleep" && a.start <= "23:00")).length;
  }
  function digitalMinimalistCount() {
    return Object.keys(state.records).filter((d) => {
      const acts = getDayActivities(d);
      const hours = sumCategory(acts, "Mobile Usage") + sumCategory(acts, "Social Media");
      return hours <= 3;
    }).length;
  }

  function renderCharts() {
    if (!window.Chart) return;
    const dayActs = getDayActivities();
    const labels = dayActs.map((a) => a.name);
    const hours = dayActs.map((a) => a.duration);
    const colors = labels.map((_, i) => `hsl(${(i * 360) / Math.max(1, labels.length)},75%,60%)`);

    const weekDates = rangeFrom(state.selectedDate, "weekly");
    const weekScores = weekDates.map(dayProductivityScore);
    const weekHours = weekDates.map((d) => calcDayTotal(getDayActivities(d)));

    const monthlyDates = rangeFrom(state.selectedDate, "monthly");
    const monthTotals = monthlyDates.map((d) => calcDayTotal(getDayActivities(d)));

    buildChart("pieChart", "pie", labels, hours, colors);
    buildChart("doughnutChart", "doughnut", labels, hours, colors);
    buildChart("barChart", "bar", weekDates, weekHours, "#6fa8ff");
    buildChart("lineChart", "line", weekDates, weekScores, "#6ee7b7");
    buildChart("areaChart", "line", monthlyDates, monthTotals, "#f59e0b", true);

    const timelineDur = dayActs.map((a) => a.duration);
    buildChart("timelineChart", "bar", labels, timelineDur, colors, false, true);
  }

  function buildChart(id, type, labels, data, color, fill = false, horizontal = false) {
    const ctx = $(id);
    if (!ctx) return;
    charts[id]?.destroy();
    charts[id] = new Chart(ctx, {
      type,
      data: {
        labels,
        datasets: [{ label: id, data, backgroundColor: color, borderColor: color, fill }]
      },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? "y" : "x" }
    });
  }

  function renderHeatmap() {
    const year = state.selectedDate.slice(0, 4);
    const container = $("heatmap");
    container.innerHTML = "";
    for (let m = 0; m < 12; m += 1) {
      for (let d = 1; d <= 31; d += 1) {
        const date = `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const parsed = new Date(date);
        if (Number.isNaN(parsed.getTime()) || parsed.getMonth() !== m || parsed.getDate() !== d) continue;
        const s = dayProductivityScore(date);
        const cell = document.createElement("div");
        cell.className = "heat-cell";
        cell.title = `${date}: ${s}`;
        cell.style.background = `rgba(110, 231, 183, ${Math.max(0.08, s / 100)})`;
        container.appendChild(cell);
      }
    }
  }

  function startReplay() {
    const list = $("replayOutput");
    const activities = getDayActivities();
    clearInterval(replayTimer);
    list.innerHTML = "";
    let i = 0;
    replayTimer = setInterval(() => {
      if (i >= activities.length) {
        clearInterval(replayTimer);
        return;
      }
      const a = activities[i];
      const li = document.createElement("li");
      li.textContent = `${a.start}-${a.end}: ${a.name} (${a.category})`;
      list.appendChild(li);
      i += 1;
    }, 800);
  }

  function renderTimeBank() {
    const bank = {};
    Object.values(state.records).forEach((acts) => acts.forEach((a) => {
      bank[a.category] = (bank[a.category] || 0) + a.duration;
    }));
    const items = Object.entries(bank).sort((a, b) => b[1] - a[1]);
    $("timeBank").innerHTML = items.length ? items.map(([k, v]) => `<li>${k}: ${v.toFixed(2)}h</li>`).join("") : "<li>No data yet.</li>";
  }

  function renderDigitalAndFocus() {
    const acts = getDayActivities();
    const distractionHours = acts.filter((a) => DISTRACTION.has(a.category)).reduce((s, a) => s + a.duration, 0);
    const warning = distractionHours > 6 ? "High digital usage detected." : distractionHours > 3 ? "Moderate digital usage." : "Healthy digital usage.";
    const productive = acts.filter((a) => a.productive || PRODUCTIVE.has(a.category)).reduce((s, a) => s + a.duration, 0);
    const focus = clamp(Math.round((productive / Math.max(1, productive + distractionHours)) * 100));
    $("digitalMonitor").textContent = `${warning} Today: ${distractionHours.toFixed(2)}h distraction activities.`;
    $("focusScore").textContent = `Focus Score: ${focus} / 100`;
  }

  function exportJSON() {
    downloadBlob(JSON.stringify(state, null, 2), `life-analytics-${state.selectedDate}.json`, "application/json");
  }

  function importJSON(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result || "{}"));
        if (!imported.records || !imported.settings) throw new Error("Invalid file");
        state = { ...defaultState, ...imported };
        saveState();
        renderAll();
        $("backupStatus").textContent = "Data imported successfully.";
      } catch {
        $("backupStatus").textContent = "Failed to import JSON.";
      }
    };
    reader.readAsText(file);
  }

  function exportCSV() {
    const rows = [["date", "name", "category", "start", "end", "duration", "productive"]];
    Object.entries(state.records).forEach(([date, acts]) => acts.forEach((a) => rows.push([date, a.name, a.category, a.start, a.end, a.duration, a.productive])));
    const csv = rows.map((r) => r.map(csvSafe).join(",")).join("\n");
    downloadBlob(csv, `life-analytics-${state.selectedDate}.csv`, "text/csv");
  }

  function backupData() {
    state.backups.push({ createdAt: new Date().toISOString(), snapshot: structuredClone(state) });
    if (state.backups.length > 10) state.backups.shift();
    saveState();
    $("backupStatus").textContent = "Backup created.";
  }

  function restoreData() {
    const last = state.backups[state.backups.length - 1];
    if (!last) {
      $("backupStatus").textContent = "No backup found.";
      return;
    }
    state = { ...defaultState, ...last.snapshot };
    saveState();
    renderAll();
    $("backupStatus").textContent = `Restored backup from ${new Date(last.createdAt).toLocaleString()}.`;
  }

  function renderReportPreview() {
    const range = $("reportRange").value;
    const dates = rangeFrom(state.selectedDate, range);
    const totalHours = sumRange(dates).toFixed(2);
    const avgScore = Math.round(dates.reduce((s, d) => s + dayProductivityScore(d), 0) / Math.max(1, dates.length));
    const body = [
      `Life Analytics ${range.toUpperCase()} Report`,
      `Period ending: ${state.selectedDate}`,
      `Tracked hours: ${totalHours}`,
      `Average productivity score: ${avgScore}`,
      `Top productive day: ${mostProductiveWeekday()}`,
      `Current achievements: ${state.achievements.join(", ") || "None"}`
    ].join("\n");
    $("reportPreview").textContent = body;
  }

  function downloadReport() {
    renderReportPreview();
    downloadBlob($("reportPreview").textContent, `life-report-${state.selectedDate}.txt`, "text/plain");
  }

  function renderAll() {
    updateClockWidget();
    renderWidgets();
    renderActivitiesList();
    renderGoals();
    renderScoreCircles();
    renderHabitStats();
    renderCharts();
    renderHeatmap();
    renderInsights();
    renderTimeBank();
    renderDigitalAndFocus();
    renderReportPreview();
  }

  function rangeFrom(date, range) {
    const d = new Date(date);
    if (range === "daily") return [fmtDate(d)];
    if (range === "weekly") {
      const out = [];
      const day = d.getDay();
      d.setDate(d.getDate() - day);
      for (let i = 0; i < 7; i += 1) out.push(fmtDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i)));
      return out;
    }
    if (range === "monthly") {
      const out = [];
      const year = d.getFullYear();
      const month = d.getMonth();
      const days = new Date(year, month + 1, 0).getDate();
      for (let i = 1; i <= days; i += 1) out.push(fmtDate(new Date(year, month, i)));
      return out;
    }
    const year = d.getFullYear();
    const out = [];
    for (let m = 0; m < 12; m += 1) {
      const days = new Date(year, m + 1, 0).getDate();
      for (let i = 1; i <= days; i += 1) out.push(fmtDate(new Date(year, m, i)));
    }
    return out;
  }

  function sumRange(dates) {
    return dates.reduce((s, d) => s + calcDayTotal(getDayActivities(d)), 0);
  }

  function averageCategory(category) {
    const dates = Object.keys(state.records);
    if (!dates.length) return "0.00h";
    const total = dates.reduce((s, d) => s + sumCategory(getDayActivities(d), category), 0);
    return `${(total / dates.length).toFixed(2)}h`;
  }

  function averageCategories(categories) {
    const dates = Object.keys(state.records);
    if (!dates.length) return "0.00h";
    const total = dates.reduce((s, d) => s + categories.reduce((x, c) => x + sumCategory(getDayActivities(d), c), 0), 0);
    return `${(total / dates.length).toFixed(2)}h`;
  }

  function sumCategory(activities, category) {
    return activities.filter((a) => a.category === category).reduce((s, a) => s + a.duration, 0);
  }

  function moodProductivityCorrelation() {
    const map = { great: 5, good: 4, neutral: 3, low: 2, stressed: 1 };
    const pairs = Object.entries(state.moods)
      .map(([date, mood]) => ({ m: map[mood], p: dayProductivityScore(date) }))
      .filter((x) => Number.isFinite(x.m) && Number.isFinite(x.p));
    if (pairs.length < 2) return "Need more data";
    const meanM = pairs.reduce((s, x) => s + x.m, 0) / pairs.length;
    const meanP = pairs.reduce((s, x) => s + x.p, 0) / pairs.length;
    let num = 0;
    let den1 = 0;
    let den2 = 0;
    pairs.forEach((x) => {
      num += (x.m - meanM) * (x.p - meanP);
      den1 += (x.m - meanM) ** 2;
      den2 += (x.p - meanP) ** 2;
    });
    const corr = num / Math.sqrt(den1 * den2 || 1);
    return corr > 0.3 ? "Positive" : corr < -0.3 ? "Negative" : "Neutral";
  }

  function downloadBlob(content, name, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function csvSafe(v) {
    const s = String(v ?? "").replace(/"/g, '""');
    return /[,"\n]/.test(s) ? `"${s}"` : s;
  }

  function clamp(v) {
    return Math.max(0, Math.min(100, v));
  }

  function hashCode(str) {
    return [...str].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  init();
})();
