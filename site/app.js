const colors = ["#0b7a45", "#c0362c", "#286b9a", "#c58a24", "#6f42c1", "#222222", "#d14f7b", "#00878f", "#7a5b2e", "#5b8f22", "#a24416", "#3858b8"];
const matchTimeZoneOffset = "+02:00";
const excludedPlayerNames = new Set(["API Match ID", "Status"]);
const nextGameHoldMilliseconds = 2 * 60 * 60 * 1000;
let currentData;
let chartState;
let selectedChartType = "full";
let selectedChartPlayers = new Set();

const chartPlayerPresets = [
  { label: "Wiebe/Heleen", players: ["Wiebe", "Heleen"] },
  { label: "Susanne/Nina", players: ["Susanne", "Nina"] },
  { label: "Familie Kolfschoten", players: ["Remo", "Renske", "Xavi", "Manuel"] },
  { label: "Floris/Shino/Toma", players: ["Floris", "Shino", "Toma"] },
  { label: "Familie Kuiper", players: ["Bert", "Thea", "Ryan", "Dionne"] },
];

function sortValues(values) {
  return values.sort((a, b) => {
    const numberA = Number(a);
    const numberB = Number(b);
    if (!Number.isNaN(numberA) && !Number.isNaN(numberB)) return numberA - numberB;
    return String(a).localeCompare(String(b));
  });
}

function normalizeData(data) {
  const players = data.players.filter((player) => !excludedPlayerNames.has(player));
  const playerSet = new Set(players);
  data.players = players;
  data.leaderboard = data.leaderboard.filter((row) => playerSet.has(row.player));
  data.progress = Object.fromEntries(Object.entries(data.progress).filter(([player]) => playerSet.has(player)));
  if (data.winner?.predictions) {
    data.winner.predictions = Object.fromEntries(Object.entries(data.winner.predictions).filter(([player]) => playerSet.has(player)));
  }
  data.matches.forEach((match) => {
    match.points = Object.fromEntries(Object.entries(match.points || {}).filter(([player]) => playerSet.has(player)));
    match.predictions = Object.fromEntries(Object.entries(match.predictions || {}).filter(([player]) => playerSet.has(player)));
  });
  return data;
}

function pointClass(points, played) {
  if (!played) return "score-unplayed";
  if (points >= 10) return "score-10";
  if (points >= 7) return "score-7";
  if (points >= 5) return "score-5";
  if (points >= 2) return "score-2";
  return "score-0";
}

function playerButton(player) {
  return `<button class="player-link" type="button" data-profile-player="${player}">${player}</button>`;
}

function chartValuesForPlayer(data, player) {
  const values = data.progress[player].filter((value) => value !== null);
  if (data.winner?.actual && values.length) {
    const winnerPoints = data.winner.predictions[player]?.points || 0;
    return [...values, values[values.length - 1] + winnerPoints];
  }
  return values;
}

function niceChartMax(value) {
  return Math.max(10, Math.ceil(value / 10) * 10);
}

function chartXLabel(index, pointCount, playedCount, hasWinnerPoint) {
  if (index === 0) return "Game 1";
  if (hasWinnerPoint && index === pointCount - 1) return "Winner";
  return `Game ${Math.min(index + 1, playedCount)}`;
}

function playedProgressValuesForPlayer(data, player) {
  return data.progress[player].filter((value) => value !== null);
}

function selectedChartPlayerList(data) {
  return data.players.filter((player) => selectedChartPlayers.has(player));
}

function chartConfig(data, type, players = data.players) {
  const playedCount = data.matches.filter((match) => match.score).length;
  const hasWinnerPoint = Boolean(data.winner?.actual);

  if (type === "lastFive") {
    const series = Object.fromEntries(players.map((player) => {
      const values = playedProgressValuesForPlayer(data, player);
      return [player, values.slice(-5)];
    }));
    const firstGame = Math.max(1, playedCount - Math.max(0, Math.max(...Object.values(series).map((values) => values.length)) - 1));
    const values = Object.values(series).flat();
    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = Math.max(10, ...values);
    const yMin = minValue > 10 && maxValue - minValue <= maxValue * 0.55
      ? Math.max(0, Math.floor((minValue - 5) / 5) * 5)
      : 0;

    return {
      type,
      series,
      playedCount,
      hasWinnerPoint: false,
      maxScore: niceChartMax(maxValue),
      minScore: yMin,
      brokenAxis: yMin > 0,
      xAxisTitle: "Last 5 games",
      yAxisTitle: "Total points",
      note: yMin > 0 ? `Y-axis starts at ${yMin} to make recent movement easier to compare.` : "",
      xLabel: (index) => `Game ${firstGame + index}`,
      legendValue: (values) => values[values.length - 1] || 0,
      tooltipValue: (values) => values[values.length - 1] || 0,
    };
  }

  if (type === "momentum") {
    const series = Object.fromEntries(players.map((player) => {
      const values = playedProgressValuesForPlayer(data, player);
      const start = Math.max(0, values.length - 5);
      return [player, values.slice(start).map((value, index) => {
        const previous = values[start + index - 1] || 0;
        return value - previous;
      })];
    }));
    const pointCount = Math.max(1, Math.max(...Object.values(series).map((values) => values.length)));
    const firstGame = Math.max(1, playedCount - pointCount + 1);
    const values = Object.values(series).flat();

    return {
      type,
      series,
      playedCount,
      hasWinnerPoint: false,
      maxScore: niceChartMax(Math.max(10, ...values)),
      minScore: 0,
      brokenAxis: false,
      xAxisTitle: "Points gained in the last 5 games",
      yAxisTitle: "Points gained",
      note: "Momentum shows per-game points instead of running totals.",
      xLabel: (index) => `Game ${firstGame + index}`,
      legendValue: (values) => values.reduce((total, value) => total + value, 0),
      tooltipValue: (values) => values[values.length - 1] || 0,
    };
  }

  const series = Object.fromEntries(players.map((player) => [player, chartValuesForPlayer(data, player)]));
  const playedValues = Object.values(series).flat();

  return {
    type,
    series,
    playedCount,
    hasWinnerPoint,
    maxScore: niceChartMax(Math.max(10, ...playedValues)),
    minScore: 0,
    brokenAxis: false,
    xAxisTitle: "Progress by game",
    yAxisTitle: "Total points",
    note: "",
    xLabel: (index, pointCount) => chartXLabel(index, pointCount, playedCount, hasWinnerPoint),
    legendValue: (values) => values[values.length - 1] || 0,
    tooltipValue: (values) => values[values.length - 1] || 0,
  };
}

function parseScore(score) {
  if (!score) return null;
  const match = String(score).trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function sideResultPoints(score, side) {
  if (score[0] === score[1]) return 1;
  const homeWon = score[0] > score[1];
  return (side === "home" && homeWon) || (side === "away" && !homeWon) ? 3 : 0;
}

function rowsForMatches(data, matches) {
  return data.players
    .map((player) => ({
      player,
      points: matches.reduce((total, match) => total + match.points[player], 0),
    }))
    .sort((a, b) => b.points - a.points || a.player.localeCompare(b.player));
}

function rowsWithRanks(rows) {
  let previousPoints = null;
  let previousRank = 0;

  return rows.map((row, index) => {
    const rank = row.points === previousPoints ? previousRank : index + 1;
    previousPoints = row.points;
    previousRank = rank;
    return { ...row, rank };
  });
}

function renderPlayerRows(target, rows) {
  document.querySelector(target).innerHTML = rowsWithRanks(rows)
    .map((row) => `
      <tr>
        <td>${row.rank}</td>
        <td>
          <span class="player-cell">
            ${playerButton(row.player)}
            ${movementBadge(row.movement)}
          </span>
        </td>
        <td><strong>${row.points}</strong></td>
      </tr>
    `)
    .join("");
}

function renderSimpleRows(target, rows, keys) {
  document.querySelector(target).innerHTML = rows
    .map((row) => `
      <tr>
        ${keys.map((key) => `<td>${row[key]}</td>`).join("")}
      </tr>
    `)
    .join("");
}

function playerTable(rows) {
  return `
    <table>
      <thead>
        <tr><th>#</th><th>Player</th><th>Points</th></tr>
      </thead>
      <tbody>
        ${rowsWithRanks(rows).map((row) => `
          <tr>
            <td>${row.rank}</td>
            <td>${row.player}</td>
            <td><strong>${row.points}</strong></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function simpleTable(headings, rows, keys) {
  return `
    <table>
      <thead>
        <tr>${headings.map((heading) => `<th>${heading}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>${keys.map((key) => `<td>${row[key]}</td>`).join("")}</tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function statTable(headings, rows, keys) {
  return `
    <table class="stat-table">
      <thead>
        <tr>${headings.map((heading) => `<th>${heading}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>${keys.map((key) => `<td>${row[key]}</td>`).join("")}</tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function biggestMoversTable(rows) {
  if (!rows.length) {
    return "<p class=\"stat-note\">No rank changes in this selection.</p>";
  }

  return `
    <table class="movers-table">
      <thead>
        <tr><th>Player</th><th>Move</th><th>From → To</th><th>Points</th></tr>
      </thead>
      <tbody>
        ${rows.map((row, index) => `
          <tr style="--row-delay: ${index * 45}ms">
            <td>${row.player}</td>
            <td>${row.change}</td>
            <td>${row.fromTo}</td>
            <td><strong>${row.points}</strong></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function biggestMoversPanel(data, gameCount = 1) {
  const playedMatches = playedMatchesByDate(data);
  if (!playedMatches.length) return "<p class=\"stat-note\">No matches have been played yet.</p>";

  const maxGames = Math.min(10, playedMatches.length);
  const count = Math.max(1, Math.min(maxGames, gameCount));
  const matches = playedMatches.slice(-count);
  const firstMatch = matches[0];
  const lastMatch = matches[matches.length - 1];
  const scope = count === 1 ? `${lastMatch.id}. ${lastMatch.label}` : `${firstMatch.id} to ${lastMatch.id}`;

  return `
    <div class="stat-control">
      <label for="moverWindow">Last <strong id="moverWindowValue">${count}</strong> <span id="moverWindowUnit">${count === 1 ? "game" : "games"}</span></label>
      <input id="moverWindow" type="range" min="1" max="${maxGames}" value="${count}" step="1">
    </div>
    <p class="stat-note" id="moverWindowNote">Rank changes from ${scope}. Positive points are from the selected games only.</p>
    <div id="biggestMoversTable">
      ${biggestMoversTable(biggestMoverRows(data, count))}
    </div>
  `;
}

function latestPlayedMatch(data) {
  return [...data.matches]
    .filter((match) => match.score)
    .sort((a, b) => matchTimestamp(b) - matchTimestamp(a) || b.id - a.id)[0];
}

function playedMatchesByDate(data) {
  return [...data.matches]
    .filter((match) => match.score)
    .sort((a, b) => matchTimestamp(a) - matchTimestamp(b) || a.id - b.id);
}

function matchTopPerformers(data, match, count = 3) {
  return data.players
    .map((player) => ({
      player,
      points: match.points[player] || 0,
    }))
    .sort((a, b) => b.points - a.points || a.player.localeCompare(b.player))
    .slice(0, count);
}

function recentResultRows(data, count = 3) {
  return playedMatchesByDate(data)
    .slice(-count)
    .reverse()
    .map((match) => ({
      match,
      total: data.players.reduce((sum, player) => sum + (match.points[player] || 0), 0),
      performers: matchTopPerformers(data, match),
    }));
}

function rankMap(rows) {
  return Object.fromEntries(rowsWithRanks(rows).map((row) => [row.player, row.rank]));
}

function leaderboardMovement(data) {
  const latest = latestPlayedMatch(data);
  if (!latest) return { latest: null, byPlayer: {} };

  const previousRows = data.leaderboard
    .map((row) => ({
      player: row.player,
      points: row.points - (latest.points[row.player] || 0),
    }))
    .sort((a, b) => b.points - a.points || a.player.localeCompare(b.player));

  const previousRanks = rankMap(previousRows);
  const currentRanks = rankMap(data.leaderboard);
  const byPlayer = {};

  data.players.forEach((player) => {
    byPlayer[player] = {
      movement: previousRanks[player] - currentRanks[player],
      previousRank: previousRanks[player],
      currentRank: currentRanks[player],
      latestPoints: latest.points[player] || 0,
    };
  });

  return { latest, byPlayer };
}

function movementBadge(movement) {
  if (!movement) return "";
  const direction = movement > 0 ? "up" : "down";
  const label = movement > 0 ? `Up ${movement}` : `Down ${Math.abs(movement)}`;
  const arrow = movement > 0 ? "▲" : "▼";
  return `<span class="mover mover-${direction}" aria-label="${label}"><span aria-hidden="true">${arrow}</span>${Math.abs(movement)}</span>`;
}

function biggestMoverWindow(data, gameCount) {
  const playedMatches = playedMatchesByDate(data);
  const count = Math.max(1, Math.min(10, gameCount, playedMatches.length));
  const matches = playedMatches.slice(-count);
  if (!matches.length) return { matches: [], byPlayer: {} };

  const windowPoints = Object.fromEntries(data.players.map((player) => [
    player,
    matches.reduce((total, match) => total + (match.points[player] || 0), 0),
  ]));
  const previousRows = data.leaderboard
    .map((row) => ({
      player: row.player,
      points: row.points - windowPoints[row.player],
    }))
    .sort((a, b) => b.points - a.points || a.player.localeCompare(b.player));

  const previousRanks = rankMap(previousRows);
  const currentRanks = rankMap(data.leaderboard);
  const byPlayer = {};

  data.players.forEach((player) => {
    byPlayer[player] = {
      movement: previousRanks[player] - currentRanks[player],
      previousRank: previousRanks[player],
      currentRank: currentRanks[player],
      windowPoints: windowPoints[player],
    };
  });

  return { matches, byPlayer };
}

function biggestMoverRows(data, gameCount = 1) {
  const { matches, byPlayer } = biggestMoverWindow(data, gameCount);
  if (!matches.length) return [];

  return data.players
    .map((player) => ({
      player,
      movement: byPlayer[player].movement,
      change: movementBadge(byPlayer[player].movement),
      fromTo: `${byPlayer[player].previousRank} → ${byPlayer[player].currentRank}`,
      points: byPlayer[player].windowPoints,
    }))
    .filter((row) => row.movement !== 0)
    .sort((a, b) => Math.abs(b.movement) - Math.abs(a.movement) || b.movement - a.movement || a.player.localeCompare(b.player));
}

function upcomingMatches(data) {
  const now = Date.now();
  return data.matches
    .filter((match) => matchTimestamp(match) > now)
    .sort((a, b) => matchTimestamp(a) - matchTimestamp(b) || a.id - b.id);
}

function predictionConsensusRows(data) {
  return upcomingMatches(data).map((match) => {
    const counts = new Map();
    const predictions = data.players
      .map((player) => ({
        player,
        prediction: match.predictions?.[player] || "",
      }))
      .filter((row) => row.prediction);

    predictions.forEach((row) => {
      counts.set(row.prediction, (counts.get(row.prediction) || 0) + 1);
    });

    const consensus = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const consensusScore = consensus?.[1] > 1 ? consensus[0] : "";
    const consensusCount = consensusScore ? consensus[1] : 0;
    const against = predictions
      .filter((row) => row.prediction !== consensusScore)
      .map((row) => `${row.player} (${row.prediction})`);

    return {
      game: `${match.id}. ${match.label}`,
      date: matchDateTimeLabel(match),
      consensus: consensusCount ? `${consensusScore} (${consensusCount}/${data.players.length})` : "No consensus",
      against: consensusCount ? (against.length ? against.join(", ") : "Nobody") : predictions.map((row) => `${row.player} (${row.prediction})`).join(", "),
    };
  });
}

function predictionConsensusTable(rows) {
  if (!rows.length) return "<p class=\"stat-note\">No upcoming matches.</p>";
  return `
    <div class="consensus-list">
      ${rows.slice(0, 5).map((row) => `
        <article class="consensus-card">
          <div>
            <div class="next-game-meta">${row.date}</div>
            <div class="mini-heading">${row.game}</div>
          </div>
          <div class="consensus-score">
            <span>Consensus</span>
            <b>${row.consensus}</b>
          </div>
          <div class="consensus-against">
            <span>Against the group</span>
            <p>${row.against}</p>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderLeaderboard(data) {
  const { byPlayer } = leaderboardMovement(data);
  const rows = data.leaderboard.map((row) => ({
    ...row,
    movement: byPlayer[row.player]?.movement || 0,
  }));
  renderPlayerRows("#leaderboard", rows);
}

function playerRank(data, player) {
  return rowsWithRanks(data.leaderboard).find((row) => row.player === player)?.rank || "-";
}

function playerPredictionRows(data, player) {
  return playedMatchesByDate(data).slice(-5).reverse().map((match) => ({
    game: `${match.id}. ${match.label}`,
    prediction: match.predictions?.[player] || "-",
    result: match.score || "-",
    points: match.points[player] || 0,
  }));
}

function renderPlayerProfile(data, player) {
  const leaderboardRow = data.leaderboard.find((row) => row.player === player) || { points: 0, matchPoints: 0, winnerPoints: 0 };
  const playedMatches = playedMatchesByDate(data);
  const playerMatches = playedMatches.map((match) => ({
    match,
    points: match.points[player] || 0,
  }));
  const exact = playerMatches.filter((row) => row.points === 10).length;
  const average = playerMatches.length ? (leaderboardRow.matchPoints / playerMatches.length).toFixed(1) : "0.0";
  const lastFiveMatches = playerMatches.slice(-5);
  const lastFivePoints = lastFiveMatches.reduce((total, row) => total + row.points, 0);
  const lastFiveAverage = lastFiveMatches.length ? (lastFivePoints / lastFiveMatches.length).toFixed(1) : "0.0";
  const winnerPick = data.winner?.predictions?.[player]?.winner || "-";
  const movement = leaderboardMovement(data).byPlayer[player]?.movement || 0;
  const predictions = playerPredictionRows(data, player);

  document.querySelector("#playerProfile").innerHTML = `
    <div class="profile-summary">
      <div>
        <span>Rank</span>
        <strong>#${playerRank(data, player)}</strong>
      </div>
      <div>
        <span>Total</span>
        <strong>${leaderboardRow.points}</strong>
      </div>
      <div>
        <span>Last 5</span>
        <strong>${lastFivePoints}</strong>
      </div>
      <div>
        <span>Exact</span>
        <strong>${exact}</strong>
      </div>
    </div>
    <div class="profile-meta">
      <span>${movementBadge(movement) || "No rank change after the latest game"}</span>
      <span>Average ${average} points per played game</span>
      <span>Winner pick: <strong>${winnerPick}</strong></span>
      <span>Last 5 average: <strong>${lastFiveAverage}</strong></span>
    </div>
    <table class="profile-table">
      <thead>
        <tr><th>Game</th><th>Prediction</th><th>Result</th><th>Points</th></tr>
      </thead>
      <tbody>
        ${predictions.map((row) => `
          <tr>
            <td>${row.game}</td>
            <td>${row.prediction}</td>
            <td>${row.result}</td>
            <td>${row.points}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function selectPlayerProfile(player) {
  const picker = document.querySelector("#playerPicker");
  if (!currentData || !picker) return;
  picker.value = player;
  renderPlayerProfile(currentData, player);
}

function renderPlayerProfilePicker(data) {
  const picker = document.querySelector("#playerPicker");
  picker.innerHTML = data.players.map((player) => `<option value="${player}">${player}</option>`).join("");
  picker.value = data.leaderboard[0]?.player || data.players[0];
  renderPlayerProfile(data, picker.value);
  picker.addEventListener("change", () => renderPlayerProfile(currentData, picker.value));
}

function bindProfileLinks() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-profile-player]");
    if (!button) return;
    selectPlayerProfile(button.dataset.profilePlayer);
    document.querySelector("#playerProfile")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function matchDateTimeLabel(match) {
  if (!match.date && !match.time) return "-";
  const date = match.date || "";
  const time = match.time || "";
  return `${date} ${time}`.trim();
}

function matchTimestamp(match) {
  if (!match.date) return Number.MAX_SAFE_INTEGER;
  const value = Date.parse(`${match.date}T${match.time || "00:00"}:00${matchTimeZoneOffset}`);
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}

function nextGameDisplayUntil(match) {
  return matchTimestamp(match) + nextGameHoldMilliseconds;
}

function isInProgressMatch(match, now = Date.now()) {
  const kickoff = matchTimestamp(match);
  return kickoff <= now && nextGameDisplayUntil(match) > now;
}

function isNederlandMatch(match) {
  return [match.country1, match.country2].some((country) => String(country || "").trim().toLowerCase() === "nederland");
}

function formatCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    days,
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
    seconds: String(seconds).padStart(2, "0"),
  };
}

function updateNextGameCountdown() {
  const countdown = document.querySelector("[data-countdown-target]");
  const liveScore = document.querySelector("[data-next-game-display-until]");
  if (!countdown && !liveScore) return;

  const displayUntilElement = countdown || liveScore;
  const displayUntil = Number(displayUntilElement.dataset.countdownDisplayUntil || displayUntilElement.dataset.nextGameDisplayUntil);
  if (displayUntil && Date.now() > displayUntil && currentData) {
    renderNextGame(currentData);
    return;
  }

  if (!countdown) return;

  const target = Number(countdown.dataset.countdownTarget);
  const remaining = target - Date.now();

  if (remaining <= 0) {
    if (currentData && !countdown.closest(".next-game-card")?.querySelector(".next-game-kicker")?.classList.contains("is-in-progress")) {
      renderNextGame(currentData);
      return;
    }

    countdown.innerHTML = `
      <span class="countdown-unit"><b>00</b><span>days</span></span>
      <span class="countdown-unit"><b>00</b><span>hours</span></span>
      <span class="countdown-unit"><b>00</b><span>min</span></span>
      <span class="countdown-unit"><b>00</b><span>sec</span></span>
    `;
    countdown.closest(".next-game-card")?.classList.add("is-starting");
    return;
  }

  const time = formatCountdown(remaining);
  countdown.innerHTML = `
    <span class="countdown-unit"><b>${String(time.days).padStart(2, "0")}</b><span>days</span></span>
    <span class="countdown-unit"><b>${time.hours}</b><span>hours</span></span>
    <span class="countdown-unit"><b>${time.minutes}</b><span>min</span></span>
    <span class="countdown-unit"><b>${time.seconds}</b><span>sec</span></span>
  `;
}

function renderNextGame(data) {
  const now = Date.now();
  const next = data.matches
    .filter((match) => nextGameDisplayUntil(match) > now)
    .sort((a, b) => matchTimestamp(a) - matchTimestamp(b) || a.id - b.id)[0];

  const section = document.querySelector("#nextGameSection");
  document.body.classList.toggle("oranje-mode", Boolean(next && isNederlandMatch(next)));
  if (!next) {
    section.style.display = "none";
    return;
  }

  section.style.display = "";
  const kickoff = matchTimestamp(next);
  const displayUntil = nextGameDisplayUntil(next);
  const inProgress = isInProgressMatch(next, now);
  const kicker = inProgress ? "In progress" : "Coming up";
  const kickerClass = inProgress ? " is-in-progress" : "";
  const countdownOrScore = inProgress
    ? `
      <div class="next-game-live-score" data-next-game-display-until="${displayUntil}" aria-live="polite">
        <span>Current score</span>
        <b>${next.score || "-"}</b>
      </div>
    `
    : `<div class="next-game-countdown" data-countdown-target="${kickoff}" data-countdown-display-until="${displayUntil}" aria-live="polite"></div>`;
  const recentRows = recentResultRows(data);
  document.querySelector("#nextGame").innerHTML = `
    <div class="next-game-layout">
      <div class="next-game-card">
        <div class="next-game-main">
          <div class="next-game-kicker${kickerClass}">${kicker}</div>
          <h3>${next.label}</h3>
          <div class="next-game-meta">${matchDateTimeLabel(next)} · Group ${next.group} · Round ${next.round}</div>
        </div>
        ${countdownOrScore}
        <div class="next-game-predictions">
          <div class="mini-heading">Predictions</div>
          <div class="prediction-grid">
            ${data.players.map((player) => `
              <div class="prediction-card prediction-card-next">
                <b>${player}</b>
                <span>${next.predictions?.[player] || "-"}</span>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
      ${recentRows.length ? `
        <div class="recent-results-card">
          <div class="mini-heading">Previous results</div>
          <div class="recent-results-list">
            ${recentRows.map((row) => `
              <article class="recent-result">
                <div class="recent-result-main">
                  <div class="next-game-meta">${matchDateTimeLabel(row.match)} · Group ${row.match.group}</div>
                  <h3>${row.match.id}. ${row.match.label}</h3>
                  <div class="recent-result-score">${row.match.score}</div>
                </div>
                <div class="recent-result-points">
                  <span>Points gained</span>
                  <b>${row.total}</b>
                </div>
                <div class="recent-performers" aria-label="Best 3 performers">
                  ${row.performers.map((performer, index) => `
                    <span><b>${index + 1}. ${performer.player}</b> ${performer.points}</span>
                  `).join("")}
                </div>
              </article>
            `).join("")}
          </div>
        </div>
      ` : ""}
    </div>
  `;
  updateNextGameCountdown();
  window.clearInterval(window.nextGameCountdownTimer);
  window.nextGameCountdownTimer = window.setInterval(updateNextGameCountdown, 1000);
}

function renderMatches(data) {
  document.querySelector("#matchHead").innerHTML = `
    <th>Game</th>
    <th>Date/time</th>
    <th>Group</th>
    <th>Round</th>
    <th>Score</th>
    <th>Points</th>
  `;

  document.querySelector("#matches").innerHTML = data.matches
    .map((match) => {
      const values = data.players.map((player) => match.points[player]);
      const total = values.reduce((sum, points) => sum + points, 0);
      const best = Math.max(...values);
      return `
        <tr class="match-summary" data-match-id="${match.id}" tabindex="0" aria-expanded="false">
          <td><span class="toggle-marker">+</span>${match.id}. ${match.label}</td>
          <td>${matchDateTimeLabel(match)}</td>
          <td>${match.group}</td>
          <td>${match.round}</td>
          <td>${match.score || "-"}</td>
          <td>
            <div class="points-list">
              ${data.players.map((player) => `
                <span class="score-chip ${pointClass(match.points[player], Boolean(match.score))}"><b>${player}</b> ${match.points[player]}</span>
              `).join("")}
            </div>
            <div class="mobile-points-summary">${match.score ? `Total ${total} · Best ${best}` : "Not played yet"}</div>
          </td>
        </tr>
        <tr class="match-details" data-match-details="${match.id}">
          <td colspan="6">
            <div class="prediction-grid">
              ${data.players.map((player) => `
                <div class="prediction-card">
                  <b>${player}</b>
                  <span>${match.predictions?.[player] || "-"}</span>
                  <span>${match.points[player]} pts</span>
                </div>
              `).join("")}
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  bindMatchToggles();
}

function toggleMatch(row) {
  const matchId = row.dataset.matchId;
  const details = document.querySelector(`[data-match-details="${matchId}"]`);
  const open = row.classList.toggle("is-open");
  row.setAttribute("aria-expanded", String(open));
  details.classList.toggle("is-open", open);
  row.querySelector(".toggle-marker").textContent = open ? "-" : "+";
}

function bindMatchToggles() {
  document.querySelectorAll(".match-summary").forEach((row) => {
    row.addEventListener("click", () => toggleMatch(row));
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleMatch(row);
    });
  });
}

function drawChart(data, type = selectedChartType) {
  const canvas = document.querySelector("#progressChart");
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const players = selectedChartPlayerList(data);

  if (!players.length) {
    drawGeekNoData(context, width, height, "Select players to show");
    chartState = {
      data,
      config: { tooltipValue: () => 0 },
      series: {},
      pointsByPlayer: {},
      players: [],
      hoveredPlayer: null,
    };
    document.querySelector("#chartLegend").innerHTML = "";
    const note = document.querySelector("#chartNote");
    note.textContent = "Use the checkboxes or presets to add lines to the chart.";
    note.hidden = false;
    bindChartHover();
    return;
  }

  const padding = { top: 30, right: 78, bottom: 58, left: 68 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const config = chartConfig(data, type, players);
  const { series, maxScore, minScore } = config;
  const scoreRange = Math.max(1, maxScore - minScore);
  const pointCount = Math.max(1, Math.max(...Object.values(series).map((values) => values.length)));
  const pointsByPlayer = {};

  players.forEach((player) => {
    pointsByPlayer[player] = series[player].map((value, index) => ({
      value,
      x: padding.left + (index / Math.max(1, pointCount - 1)) * chartWidth,
      y: height - padding.bottom - ((value - minScore) / scoreRange) * chartHeight,
    }));
  });

  chartState = {
    data,
    config,
    padding,
    chartWidth,
    chartHeight,
    maxScore,
    minScore,
    scoreRange,
    pointCount,
    players,
    series,
    pointsByPlayer,
    hoveredPlayer: chartState?.hoveredPlayer || null,
  };
  renderChart();
  bindChartHover();
}

function renderChart() {
  const canvas = document.querySelector("#progressChart");
  const context = canvas.getContext("2d");
  const tooltip = document.querySelector("#chartTooltip");
  const { data, config, padding, chartWidth, chartHeight, maxScore, minScore, scoreRange, pointCount, players, series, pointsByPlayer, hoveredPlayer } = chartState;
  const width = canvas.width;
  const height = canvas.height;
  const plotBottom = height - padding.bottom;
  const plotRight = width - padding.right;
  const plotTop = padding.top;

  context.clearRect(0, 0, width, height);

  context.font = "13px Arial";
  context.textBaseline = "middle";
  context.lineWidth = 1;
  context.strokeStyle = "#edf2ee";
  context.fillStyle = "#637069";

  for (let tick = 0; tick <= 5; tick += 1) {
    const value = Math.round(minScore + (scoreRange / 5) * tick);
    const y = plotBottom - ((value - minScore) / scoreRange) * chartHeight;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(plotRight, y);
    context.stroke();
    context.textAlign = "right";
    context.fillText(String(value), padding.left - 12, y);
  }

  const xTicks = [...new Set([0, Math.floor((pointCount - 1) / 2), pointCount - 1])].filter((tick) => tick >= 0);
  xTicks.forEach((tick) => {
    const x = padding.left + (tick / Math.max(1, pointCount - 1)) * chartWidth;
    context.strokeStyle = "#f4f7f5";
    context.beginPath();
    context.moveTo(x, plotTop);
    context.lineTo(x, plotBottom);
    context.stroke();
    context.fillStyle = "#637069";
    context.textAlign = tick === 0 ? "left" : tick === pointCount - 1 ? "right" : "center";
    context.textBaseline = "top";
    context.fillText(config.xLabel(tick, pointCount), x, plotBottom + 16);
  });

  context.strokeStyle = "#c7d6ca";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(padding.left, plotTop);
  context.lineTo(padding.left, plotBottom);
  context.lineTo(plotRight, plotBottom);
  context.stroke();

  if (config.brokenAxis) {
    context.strokeStyle = "#637069";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(padding.left - 7, plotBottom - 18);
    context.lineTo(padding.left + 7, plotBottom - 8);
    context.moveTo(padding.left - 7, plotBottom - 10);
    context.lineTo(padding.left + 7, plotBottom);
    context.stroke();
  }

  context.fillStyle = "#637069";
  context.font = "bold 13px Arial";
  context.textAlign = "center";
  context.textBaseline = "bottom";
  context.fillText(config.xAxisTitle, padding.left + chartWidth / 2, height - 8);
  context.save();
  context.translate(18, padding.top + chartHeight / 2);
  context.rotate(-Math.PI / 2);
  context.fillText(config.yAxisTitle, 0, 0);
  context.restore();

  players.forEach((player) => {
    const points = pointsByPlayer[player];
    const color = colors[data.players.indexOf(player) % colors.length];
    if (!points.length) return;

    context.globalAlpha = hoveredPlayer && hoveredPlayer !== player ? 0.18 : 1;
    context.strokeStyle = color;
    context.lineWidth = hoveredPlayer === player ? 4.5 : players.length > 5 ? 1.8 : 2.5;
    context.beginPath();
    drawSmoothLine(context, points);
    context.stroke();

    const lastPoint = points[points.length - 1];
    context.fillStyle = color;
    context.beginPath();
    context.arc(lastPoint.x, lastPoint.y, hoveredPlayer === player ? 5 : 3.5, 0, Math.PI * 2);
    context.fill();

    if (hoveredPlayer === player) {
      context.font = "bold 13px Arial";
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.fillText(`${player} ${lastPoint.value}`, Math.min(lastPoint.x + 8, width - padding.right + 4), lastPoint.y);
    }
  });
  context.globalAlpha = 1;

  document.querySelector("#chartLegend").innerHTML = players.map((player) => {
    const values = series[player];
    const finalValue = config.legendValue(values);
    const stateClass = hoveredPlayer === player ? "is-active" : hoveredPlayer ? "is-muted" : "";
    return `<span class="${stateClass}" data-chart-player="${player}" data-profile-player="${player}"><i style="background:${colors[data.players.indexOf(player) % colors.length]}"></i>${player}: ${finalValue}</span>`;
  }).join("");

  const note = document.querySelector("#chartNote");
  note.textContent = config.note;
  note.hidden = !config.note;

  if (!hoveredPlayer) {
    tooltip.classList.remove("is-visible");
  }
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  const x = start.x + t * dx;
  const y = start.y + t * dy;
  return Math.hypot(point.x - x, point.y - y);
}

function hoveredChartPlayer(canvasPoint) {
  let best = { player: null, distance: Infinity };

  Object.entries(chartState.pointsByPlayer).forEach(([player, points]) => {
    for (let index = 1; index < points.length; index += 1) {
      const distance = distanceToSegment(canvasPoint, points[index - 1], points[index]);
      if (distance < best.distance) {
        best = { player, distance };
      }
    }
  });

  return best.distance <= 14 ? best.player : null;
}

function drawSmoothLine(context, points) {
  if (points.length === 1) {
    context.moveTo(points[0].x, points[0].y);
    return;
  }

  context.moveTo(points[0].x, points[0].y);
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midpointX = current.x + (next.x - current.x) / 2;
    context.bezierCurveTo(midpointX, current.y, midpointX, next.y, next.x, next.y);
  }
}

function predictionDistance(match, player) {
  const actual = parseScore(match.score);
  const predicted = parseScore(match.predictions?.[player]);
  if (!actual || !predicted) return null;
  return Math.abs(actual[0] - predicted[0]) + Math.abs(actual[1] - predicted[1]);
}

function playerPlayedRows(data, player) {
  return playedMatchesByDate(data).map((match) => ({
    match,
    points: match.points[player] || 0,
    distance: predictionDistance(match, player),
    prediction: match.predictions?.[player] || "",
  }));
}

function drawCanvasFrame(context, width, height) {
  context.clearRect(0, 0, width, height);
  context.font = "13px Arial";
  context.lineWidth = 1;
  context.strokeStyle = "#edf2ee";
  context.fillStyle = "#637069";
}

function drawGeekNoData(context, width, height, message) {
  drawCanvasFrame(context, width, height);
  context.fillStyle = "#637069";
  context.font = "bold 15px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(message, width / 2, height / 2);
}

function drawGeekDistribution(context, data, width, height) {
  const played = playedMatchesByDate(data);
  if (!played.length) {
    drawGeekNoData(context, width, height, "No played games yet");
    return "Counts of 0, 2, 5, 7 and 10 point results per player.";
  }

  const padding = { top: 34, right: 34, bottom: 78, left: 56 };
  const buckets = [0, 2, 5, 7, 10];
  const bucketColors = { 0: "#c0362c", 2: "#f0b57a", 5: "#f3d47d", 7: "#286b9a", 10: "#0b7a45" };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxCount = played.length;
  const rankedPlayers = data.leaderboard.map((row) => row.player).filter((player) => data.players.includes(player));
  const barGap = 14;
  const barWidth = Math.max(18, (chartWidth - barGap * (rankedPlayers.length - 1)) / rankedPlayers.length);

  drawCanvasFrame(context, width, height);
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = Math.round((maxCount / 4) * tick);
    const y = height - padding.bottom - (value / Math.max(1, maxCount)) * chartHeight;
    context.strokeStyle = "#edf2ee";
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillStyle = "#637069";
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(String(value), padding.left - 10, y);
  }

  rankedPlayers.forEach((player, playerIndex) => {
    const counts = Object.fromEntries(buckets.map((bucket) => [bucket, 0]));
    played.forEach((match) => {
      counts[match.points[player] || 0] += 1;
    });
    const x = padding.left + playerIndex * (barWidth + barGap);
    let y = height - padding.bottom;
    buckets.forEach((bucket) => {
      const segmentHeight = (counts[bucket] / Math.max(1, maxCount)) * chartHeight;
      context.fillStyle = bucketColors[bucket];
      context.fillRect(x, y - segmentHeight, barWidth, segmentHeight);
      y -= segmentHeight;
    });
    context.fillStyle = "#637069";
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.save();
    context.translate(x + barWidth / 2, height - padding.bottom + 12);
    context.rotate(-Math.PI / 4);
    context.fillText(player, 0, 0);
    context.restore();
  });

  buckets.forEach((bucket, index) => {
    const x = padding.left + index * 82;
    const y = 16;
    context.fillStyle = bucketColors[bucket];
    context.fillRect(x, y, 18, 6);
    context.fillStyle = "#637069";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(`${bucket} pts`, x + 24, y + 3);
  });

  return "Stacked bars show how each player gets their points: spikes, steady partial hits, or zeros.";
}

function rawRadarMetrics(data, player) {
  const rows = playerPlayedRows(data, player);
  const playedCount = rows.length;
  const exact = rows.filter((row) => row.points === 10).length;
  const anyPoints = rows.filter((row) => row.points > 0).length;
  const average = playedCount ? rows.reduce((total, row) => total + row.points, 0) / playedCount : 0;
  const lastFive = rows.slice(-5);
  const lastFiveAverage = lastFive.length ? lastFive.reduce((total, row) => total + row.points, 0) / lastFive.length : 0;

  return [
    { label: "Exact", raw: playedCount ? exact / playedCount : 0, display: `${exact}/${playedCount}` },
    { label: "Any pts", raw: playedCount ? anyPoints / playedCount : 0, display: `${anyPoints}/${playedCount}` },
    { label: "Avg pts", raw: average, display: average.toFixed(1) },
    { label: "Last 5 avg", raw: lastFiveAverage, display: lastFiveAverage.toFixed(1) },
  ];
}

function radarMetrics(data, player) {
  const playerMetrics = rawRadarMetrics(data, player);
  const maxByLabel = Object.fromEntries(playerMetrics.map((metric) => {
    const maxValue = Math.max(...data.players.map((candidate) => rawRadarMetrics(data, candidate).find((item) => item.label === metric.label).raw));
    return [metric.label, maxValue || 1];
  }));

  return playerMetrics.map((metric) => ({
    ...metric,
    value: (metric.raw / maxByLabel[metric.label]) * 100,
  }));
}

function drawGeekRadar(context, data, player, width, height) {
  const metrics = radarMetrics(data, player);
  const center = { x: width / 2, y: height / 2 + 8 };
  const radius = Math.min(width, height) * 0.32;

  drawCanvasFrame(context, width, height);
  for (let ring = 1; ring <= 4; ring += 1) {
    context.strokeStyle = "#e6eee8";
    context.beginPath();
    metrics.forEach((metric, index) => {
      const angle = -Math.PI / 2 + (index / metrics.length) * Math.PI * 2;
      const r = radius * (ring / 4);
      const x = center.x + Math.cos(angle) * r;
      const y = center.y + Math.sin(angle) * r;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.stroke();
  }

  metrics.forEach((metric, index) => {
    const angle = -Math.PI / 2 + (index / metrics.length) * Math.PI * 2;
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;
    context.strokeStyle = "#edf2ee";
    context.beginPath();
    context.moveTo(center.x, center.y);
    context.lineTo(x, y);
    context.stroke();
    context.fillStyle = "#637069";
    context.font = "bold 12px Arial";
    context.textAlign = x < center.x - 8 ? "right" : x > center.x + 8 ? "left" : "center";
    context.textBaseline = y < center.y ? "bottom" : "top";
    context.fillText(metric.label, x, y);
    context.font = "12px Arial";
    context.fillText(metric.display, x, y < center.y ? y - 16 : y + 16);
  });

  context.beginPath();
  metrics.forEach((metric, index) => {
    const angle = -Math.PI / 2 + (index / metrics.length) * Math.PI * 2;
    const r = radius * (metric.value / 100);
    const x = center.x + Math.cos(angle) * r;
    const y = center.y + Math.sin(angle) * r;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  context.fillStyle = "rgba(11, 122, 69, 0.18)";
  context.strokeStyle = "#0b7a45";
  context.lineWidth = 2.5;
  context.fill();
  context.stroke();

  context.fillStyle = "#17201b";
  context.font = "bold 16px Arial";
  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillText(player, center.x, 18);

  return "Radar guide: Exact = exact scores in played games. Any pts = played games with at least 2 points. Avg pts = average points per played game. Last 5 avg = average points in the latest 5 played games. Each axis is normalized against the best player for that stat, so the outer ring means current best in the pool.";
}

function drawGeekVolatility(context, data, player, width, height) {
  const rows = playerPlayedRows(data, player).slice(-20);
  if (!rows.length) {
    drawGeekNoData(context, width, height, "No played games yet");
    return "Points per played game for the selected player.";
  }

  const padding = { top: 34, right: 34, bottom: 58, left: 52 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const barGap = 6;
  const barWidth = Math.max(10, (chartWidth - barGap * (rows.length - 1)) / rows.length);
  const average = rows.reduce((total, row) => total + row.points, 0) / rows.length;

  drawCanvasFrame(context, width, height);
  for (let tick = 0; tick <= 5; tick += 1) {
    const value = tick * 2;
    const y = height - padding.bottom - (value / 10) * chartHeight;
    context.strokeStyle = "#edf2ee";
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillStyle = "#637069";
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(String(value), padding.left - 10, y);
  }

  rows.forEach((row, index) => {
    const x = padding.left + index * (barWidth + barGap);
    const barHeight = (row.points / 10) * chartHeight;
    context.fillStyle = "#8fb99a";
    context.globalAlpha = row.points === 10 ? 0.95 : 0.72;
    context.fillRect(x, height - padding.bottom - barHeight, barWidth, barHeight);
    context.globalAlpha = 1;
    context.fillStyle = "#637069";
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(String(row.match.id), x + barWidth / 2, height - padding.bottom + 12);
  });

  const averageY = height - padding.bottom - (average / 10) * chartHeight;
  context.strokeStyle = "#17201b";
  context.setLineDash([6, 5]);
  context.beginPath();
  context.moveTo(padding.left, averageY);
  context.lineTo(width - padding.right, averageY);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "#17201b";
  context.textAlign = "right";
  context.textBaseline = "bottom";
  context.fillText(`avg ${average.toFixed(1)}`, width - padding.right, averageY - 5);

  return `Volatility shows ${player}'s points per played game, capped to the latest 20 games.`;
}

function drawGeekDistance(context, data, width, height) {
  const played = playedMatchesByDate(data);
  const rows = data.players.map((player) => {
    const distances = played
      .map((match) => predictionDistance(match, player))
      .filter((value) => value !== null);
    const average = distances.length ? distances.reduce((total, value) => total + value, 0) / distances.length : null;
    return { player, average, count: distances.length };
  }).filter((row) => row.average !== null)
    .sort((a, b) => a.average - b.average || a.player.localeCompare(b.player));

  if (!rows.length) {
    drawGeekNoData(context, width, height, "No comparable predictions yet");
    return "Average score distance needs played matches with filled score predictions.";
  }

  const padding = { top: 34, right: 34, bottom: 78, left: 56 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxDistance = Math.max(1, Math.ceil(Math.max(...rows.map((row) => row.average))));
  const barGap = 14;
  const barWidth = Math.max(18, (chartWidth - barGap * (rows.length - 1)) / rows.length);

  drawCanvasFrame(context, width, height);
  for (let tick = 0; tick <= maxDistance; tick += 1) {
    const y = height - padding.bottom - (tick / maxDistance) * chartHeight;
    context.strokeStyle = "#edf2ee";
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillStyle = "#637069";
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(String(tick), padding.left - 10, y);
  }

  rows.forEach((row, index) => {
    const x = padding.left + index * (barWidth + barGap);
    const barHeight = (row.average / maxDistance) * chartHeight;
    context.fillStyle = "#8fb99a";
    context.globalAlpha = 0.78;
    context.fillRect(x, height - padding.bottom - barHeight, barWidth, barHeight);
    context.globalAlpha = 1;
    context.fillStyle = "#17201b";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.fillText(row.average.toFixed(1), x + barWidth / 2, height - padding.bottom - barHeight - 5);
    context.fillStyle = "#637069";
    context.textBaseline = "middle";
    context.save();
    context.translate(x + barWidth / 2, height - padding.bottom + 12);
    context.rotate(-Math.PI / 4);
    context.fillText(row.player, 0, 0);
    context.restore();
  });

  return "Lower is better: average absolute goal distance from the actual score.";
}

function drawGeekChart(data) {
  const canvas = document.querySelector("#geekChart");
  const context = canvas.getContext("2d");
  const type = document.querySelector("#geekChartPicker").value;
  const player = document.querySelector("#geekPlayerPicker").value;
  const note = document.querySelector("#geekChartNote");
  const playerPicker = document.querySelector("#geekPlayerPicker");
  let noteText = "";

  playerPicker.disabled = type === "distribution" || type === "distance";
  if (type === "distribution") noteText = drawGeekDistribution(context, data, canvas.width, canvas.height);
  if (type === "radar") noteText = drawGeekRadar(context, data, player, canvas.width, canvas.height);
  if (type === "volatility") noteText = drawGeekVolatility(context, data, player, canvas.width, canvas.height);
  if (type === "distance") noteText = drawGeekDistance(context, data, canvas.width, canvas.height);

  note.textContent = noteText;
}

function renderGeekChartControls(data) {
  const playerPicker = document.querySelector("#geekPlayerPicker");
  playerPicker.innerHTML = data.players.map((player) => `<option value="${player}">${player}</option>`).join("");
  playerPicker.value = data.leaderboard[0]?.player || data.players[0];
  drawGeekChart(data);
  document.querySelector("#geekChartPicker").addEventListener("change", () => drawGeekChart(currentData));
  playerPicker.addEventListener("change", () => drawGeekChart(currentData));
}

function existingPresetPlayers(data, preset) {
  return preset.players.filter((player) => data.players.includes(player));
}

function updateChartFilterControls(data) {
  document.querySelectorAll("[data-chart-player-filter]").forEach((input) => {
    input.checked = selectedChartPlayers.has(input.value);
  });

  document.querySelectorAll("[data-chart-preset]").forEach((input) => {
    const preset = chartPlayerPresets.find((item) => item.label === input.value);
    const players = preset ? existingPresetPlayers(data, preset) : [];
    input.checked = players.length > 0 && players.every((player) => selectedChartPlayers.has(player));
  });
}

function redrawChartWithFilters(data) {
  updateChartFilterControls(data);
  chartState = { ...chartState, hoveredPlayer: null };
  document.querySelector("#chartTooltip").classList.remove("is-visible");
  drawChart(data, selectedChartType);
}

function renderChartPlayerControls(data) {
  if (!selectedChartPlayers.size) {
    selectedChartPlayers = new Set(data.players);
  }

  const presetControls = document.querySelector("#chartPresetControls");
  const playerControls = document.querySelector("#chartPlayerControls");

  presetControls.innerHTML = chartPlayerPresets.map((preset) => {
    const players = existingPresetPlayers(data, preset);
    const disabledClass = players.length ? "" : " is-disabled";
    return `
      <label class="chart-filter chart-filter-preset${disabledClass}" title="${preset.players.join(", ")}">
        <input type="checkbox" value="${preset.label}" data-chart-preset ${players.length ? "" : "disabled"}>
        <span>${preset.label}</span>
      </label>
    `;
  }).join("");

  playerControls.innerHTML = data.players.map((player) => `
    <label class="chart-filter chart-filter-player">
      <input type="checkbox" value="${player}" data-chart-player-filter>
      <span>${player}</span>
    </label>
  `).join("");

  updateChartFilterControls(data);
}

function bindChartPlayerControls(data) {
  const controls = document.querySelector(".chart-player-controls");
  if (controls.dataset.bound) return;
  controls.dataset.bound = "true";

  controls.addEventListener("change", (event) => {
    const playerInput = event.target.closest("[data-chart-player-filter]");
    if (playerInput) {
      if (playerInput.checked) {
        selectedChartPlayers.add(playerInput.value);
      } else {
        selectedChartPlayers.delete(playerInput.value);
      }
      redrawChartWithFilters(currentData);
      return;
    }

    const presetInput = event.target.closest("[data-chart-preset]");
    if (!presetInput) return;

    const preset = chartPlayerPresets.find((item) => item.label === presetInput.value);
    if (!preset) return;
    existingPresetPlayers(currentData, preset).forEach((player) => {
      if (presetInput.checked) {
        selectedChartPlayers.add(player);
      } else {
        selectedChartPlayers.delete(player);
      }
    });
    redrawChartWithFilters(currentData);
  });

  document.querySelector("#selectAllChartPlayers").addEventListener("click", () => {
    selectedChartPlayers = new Set(currentData.players);
    redrawChartWithFilters(currentData);
  });

  document.querySelector("#deselectAllChartPlayers").addEventListener("click", () => {
    selectedChartPlayers = new Set();
    redrawChartWithFilters(currentData);
  });
}

function bindChartHover() {
  const canvas = document.querySelector("#progressChart");
  const legend = document.querySelector("#chartLegend");
  if (canvas.dataset.hoverBound) return;
  canvas.dataset.hoverBound = "true";

  canvas.addEventListener("mousemove", (event) => {
    if (!chartState || !chartState.players.length) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasPoint = {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
    const player = hoveredChartPlayer(canvasPoint);

    chartState.hoveredPlayer = player;
    renderChart();

    const tooltip = document.querySelector("#chartTooltip");
    if (player) {
      const values = chartState.series[player];
      tooltip.textContent = `${player}: ${chartState.config.tooltipValue(values)}`;
      tooltip.style.left = `${event.clientX - rect.left}px`;
      tooltip.style.top = `${event.clientY - rect.top}px`;
      tooltip.classList.add("is-visible");
      canvas.style.cursor = "pointer";
    } else {
      tooltip.classList.remove("is-visible");
      canvas.style.cursor = "default";
    }
  });

  canvas.addEventListener("mouseleave", () => {
    if (!chartState) return;
    chartState.hoveredPlayer = null;
    document.querySelector("#chartTooltip").classList.remove("is-visible");
    canvas.style.cursor = "default";
    if (!chartState.players.length) return;
    renderChart();
  });

  legend.addEventListener("mouseover", (event) => {
    const label = event.target.closest("[data-chart-player]");
    if (!label || !chartState) return;
    chartState.hoveredPlayer = label.dataset.chartPlayer;
    renderChart();
  });

  legend.addEventListener("mouseout", (event) => {
    if (!chartState || event.relatedTarget?.closest?.("[data-chart-player]")) return;
    chartState.hoveredPlayer = null;
    renderChart();
  });
}

function bindChartPicker() {
  const picker = document.querySelector("#chartPicker");
  picker.addEventListener("change", () => {
    selectedChartType = picker.value;
    chartState = { ...chartState, hoveredPlayer: null };
    document.querySelector("#chartTooltip").classList.remove("is-visible");
    drawChart(currentData, selectedChartType);
  });
}

function bindBiggestMoversControls(data) {
  const slider = document.querySelector("#moverWindow");
  if (!slider) return;

  const value = document.querySelector("#moverWindowValue");
  const unit = document.querySelector("#moverWindowUnit");
  const note = document.querySelector("#moverWindowNote");
  const target = document.querySelector("#biggestMoversTable");
  slider.addEventListener("input", () => {
    const count = Number(slider.value);
    const matches = playedMatchesByDate(data).slice(-count);
    const firstMatch = matches[0];
    const lastMatch = matches[matches.length - 1];
    const scope = count === 1 ? `${lastMatch.id}. ${lastMatch.label}` : `${firstMatch.id} to ${lastMatch.id}`;

    value.textContent = String(count);
    unit.textContent = count === 1 ? "game" : "games";
    note.textContent = `Rank changes from ${scope}. Positive points are from the selected games only.`;
    target.innerHTML = biggestMoversTable(biggestMoverRows(data, count));
  });
}

function groupedLeaderboardTitle(field, label, value) {
  const text = String(value);
  if (field === "group" && /^[A-L]$/.test(text)) return `${label} ${text}`;
  if (field === "round" && /^[1-3]$/.test(text)) return `${label} ${text}`;
  return text;
}

function groupedLeaderboards(data, field, label) {
  const values = sortValues([...new Set(data.matches.map((match) => match[field]))]);

  return `<div class="mini-board-grid">${
    values
    .map((value) => {
      const rows = rowsForMatches(data, data.matches.filter((match) => match[field] === value));
      return `
        <article class="mini-board">
          <div class="mini-heading">${groupedLeaderboardTitle(field, label, value)}</div>
          ${rows.slice(0, 3).map((row, index) => `
            <div class="mini-row">
              <span>${index + 1}. ${row.player}</span>
              <b>${row.points}</b>
            </div>
          `).join("")}
        </article>
      `;
    })
    .join("")
  }</div>`;
}

function countryRows(data) {
  const countries = new Map();

  data.matches.filter((match) => match.score).forEach((match) => {
    const matchPoints = data.players.reduce((total, player) => total + match.points[player], 0);
    const countriesInMatch = [match.country1, match.country2];
    countriesInMatch.forEach((country) => {
      countries.set(country, (countries.get(country) || 0) + matchPoints);
    });
  });

  const rows = [...countries.entries()]
    .map(([country, points]) => ({ country, points }))
    .sort((a, b) => b.points - a.points || a.country.localeCompare(b.country));

  return rows;
}

function countrySurpriseRows(data) {
  const countries = new Map();

  function ensureCountry(country) {
    if (!countries.has(country)) {
      countries.set(country, { country, gap: 0, predictions: 0 });
    }
    return countries.get(country);
  }

  data.matches.filter((match) => match.score).forEach((match) => {
    const actual = parseScore(match.score);
    if (!actual) return;

    data.players.forEach((player) => {
      const prediction = parseScore(match.predictions?.[player]);
      if (!prediction) return;

      [
        { country: match.country1, side: "home", index: 0 },
        { country: match.country2, side: "away", index: 1 },
      ].forEach(({ country, side, index }) => {
        const predictedResult = sideResultPoints(prediction, side);
        const actualResult = sideResultPoints(actual, side);
        const predictedGoals = prediction[index];
        const actualGoals = actual[index];
        const row = ensureCountry(country);

        row.gap += (predictedResult - actualResult) * 2 + (predictedGoals - actualGoals);
        row.predictions += 1;
      });
    });
  });

  return [...countries.values()]
    .filter((row) => row.predictions)
    .map((row) => ({
      country: row.country,
      score: Number((row.gap / row.predictions).toFixed(2)),
      predictions: row.predictions,
    }));
}

function exactRows(data) {
  return data.players
    .map((player) => ({
      player,
      exact: data.matches.filter((match) => match.points[player] === 10).length,
    }))
    .sort((a, b) => b.exact - a.exact || a.player.localeCompare(b.player));
}

function winnerRows(data) {
  if (!data.winner) return [];
  return data.players.map((player) => ({
    player,
    prediction: data.winner.predictions[player]?.winner || "-",
    points: data.winner.predictions[player]?.points || 0,
  })).sort((a, b) => b.points - a.points || a.player.localeCompare(b.player));
}

function hotStreakRows(data) {
  return data.players
    .map((player) => {
      let best = { points: 0, start: 0, end: 0 };
      let current = { points: 0, start: 0 };
      const playedMatches = data.matches.filter((match) => match.score);

      playedMatches.forEach((match, index) => {
        const points = match.points[player];
        if (points <= 0) {
          current = { points: 0, start: index + 1 };
          return;
        }

        current.points += points;
        if (current.points > best.points) {
          best = { points: current.points, start: current.start, end: index };
        }
      });

      const startMatch = playedMatches[best.start];
      const endMatch = playedMatches[best.end];
      return {
        player,
        points: best.points,
        games: startMatch && endMatch ? `${startMatch.id}-${endMatch.id}` : "-",
      };
    })
    .sort((a, b) => b.points - a.points || a.player.localeCompare(b.player));
}

function gameRows(data) {
  return data.matches
    .filter((match) => match.score)
    .map((match) => ({
      game: `${match.id}. ${match.label}`,
      points: data.players.reduce((total, player) => total + match.points[player], 0),
    }))
    .sort((a, b) => b.points - a.points || a.game.localeCompare(b.game));
}

function renderSelectedStat(data) {
  const playedMatches = data.matches.filter((match) => match.score);
  const countries = countryRows(data);
  const games = gameRows(data);
  const selected = document.querySelector("#statPicker").value;
  let html = "";

  if (selected === "lastFive") {
    html = playerTable(rowsForMatches(data, playedMatches.slice(-5)));
  }
  if (selected === "biggestMovers") {
    html = biggestMoversPanel(data);
  }
  if (selected === "predictionConsensus") {
    html = `
      <p class="stat-note">Most common predicted score for upcoming matches, plus everyone who picked something different.</p>
      ${predictionConsensusTable(predictionConsensusRows(data))}
    `;
  }
  if (selected === "groups") {
    html = groupedLeaderboards(data, "group", "Group");
  }
  if (selected === "rounds") {
    html = groupedLeaderboards(data, "round", "Round");
  }
  if (selected === "bestCountries") {
    html = simpleTable(["Country", "Points"], countries.slice(0, 10), ["country", "points"]);
  }
  if (selected === "worstCountries") {
    html = simpleTable(["Country", "Points"], countries.slice(-10).reverse(), ["country", "points"]);
  }
  if (selected === "surpriseCountries") {
    const surpriseRows = countrySurpriseRows(data);
    const underrated = [...surpriseRows].sort((a, b) => a.score - b.score || a.country.localeCompare(b.country)).slice(0, 8);
    const overrated = [...surpriseRows].sort((a, b) => b.score - a.score || a.country.localeCompare(b.country)).slice(0, 8);
    html = `
      <p class="stat-note">This compares what everyone predicted for each country with what actually happened. Negative means the country did better than expected. Positive means people expected too much.</p>
      <div class="mini-heading">Most underrated</div>
      ${statTable(["Country", "Rating gap", "Predictions"], underrated, ["country", "score", "predictions"])}
      <div class="mini-heading">Most overrated</div>
      ${statTable(["Country", "Rating gap", "Predictions"], overrated, ["country", "score", "predictions"])}
    `;
  }
  if (selected === "exactScores") {
    html = simpleTable(["Player", "Exact"], exactRows(data), ["player", "exact"]);
  }
  if (selected === "hotStreaks") {
    html = `
      <p class="stat-note">Best run of consecutive played games with points. A game with 0 points ends the streak.</p>
      ${simpleTable(["Player", "Points", "Games"], hotStreakRows(data), ["player", "points", "games"])}
    `;
  }
  if (selected === "winner") {
    const title = data.winner?.actual ? `Actual winner: ${data.winner.actual}` : "Actual winner not filled yet";
    html = `<div class="mini-heading">${title}</div>${simpleTable(["Player", "Prediction", "Points"], winnerRows(data), ["player", "prediction", "points"])}`;
  }
  if (selected === "bestGames") {
    html = simpleTable(["Game", "Points"], games.slice(0, 10), ["game", "points"]);
  }
  if (selected === "hardestGames") {
    html = simpleTable(["Game", "Points"], games.slice(-10).reverse(), ["game", "points"]);
  }

  document.querySelector("#statPanel").innerHTML = html;
  if (selected === "biggestMovers") bindBiggestMoversControls(data);
}

fetch("/api/data")
  .then((response) => {
    if (!response.ok) throw new Error("Live data failed");
    return response.json();
  })
  .catch(() => fetch("data.json").then((response) => response.json()))
  .then((data) => {
    data = normalizeData(data);
    currentData = data;
    renderNextGame(data);
    renderLeaderboard(data);
    renderPlayerProfilePicker(data);
    renderMatches(data);
    renderChartPlayerControls(data);
    drawChart(data, selectedChartType);
    renderGeekChartControls(data);
    renderSelectedStat(data);
    bindChartPicker();
    bindChartPlayerControls(data);
    bindProfileLinks();
    document.querySelector("#statPicker").addEventListener("change", () => renderSelectedStat(currentData));
  });
