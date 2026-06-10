const colors = ["#0b7a45", "#c0362c", "#286b9a", "#c58a24", "#6f42c1", "#222222"];
const matchTimeZoneOffset = "+02:00";
let currentData;
let chartState;

function sortValues(values) {
  return values.sort((a, b) => {
    const numberA = Number(a);
    const numberB = Number(b);
    if (!Number.isNaN(numberA) && !Number.isNaN(numberB)) return numberA - numberB;
    return String(a).localeCompare(String(b));
  });
}

function pointClass(points, played) {
  if (!played) return "score-unplayed";
  if (points >= 10) return "score-10";
  if (points >= 7) return "score-7";
  if (points >= 5) return "score-5";
  if (points >= 2) return "score-2";
  return "score-0";
}

function chartValuesForPlayer(data, player) {
  const values = data.progress[player].filter((value) => value !== null);
  if (data.winner?.actual && values.length) {
    const winnerPoints = data.winner.predictions[player]?.points || 0;
    return [...values, values[values.length - 1] + winnerPoints];
  }
  return values;
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
            ${row.player}
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

function latestPlayedMatch(data) {
  return [...data.matches]
    .filter((match) => match.score)
    .sort((a, b) => matchTimestamp(b) - matchTimestamp(a) || b.id - a.id)[0];
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

function biggestMoverRows(data) {
  const { latest, byPlayer } = leaderboardMovement(data);
  if (!latest) return [];

  return data.players
    .map((player) => ({
      player,
      movement: byPlayer[player].movement,
      change: movementBadge(byPlayer[player].movement),
      fromTo: `${byPlayer[player].previousRank} → ${byPlayer[player].currentRank}`,
      points: byPlayer[player].latestPoints,
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
  if (!countdown) return;

  const target = Number(countdown.dataset.countdownTarget);
  const remaining = target - Date.now();

  if (remaining <= 0) {
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
    .filter((match) => matchTimestamp(match) > now)
    .sort((a, b) => matchTimestamp(a) - matchTimestamp(b) || a.id - b.id)[0];

  const section = document.querySelector("#nextGameSection");
  if (!next) {
    section.style.display = "none";
    return;
  }

  section.style.display = "";
  const kickoff = matchTimestamp(next);
  document.querySelector("#nextGame").innerHTML = `
    <div class="next-game-card">
      <div class="next-game-main">
        <div class="next-game-kicker">Coming up</div>
        <h3>${next.label}</h3>
        <div class="next-game-meta">${matchDateTimeLabel(next)} · Group ${next.group} · Round ${next.round}</div>
      </div>
      <div class="next-game-countdown" data-countdown-target="${kickoff}" aria-live="polite"></div>
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

function drawChart(data) {
  const canvas = document.querySelector("#progressChart");
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = 48;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const playedCount = data.matches.filter((match) => match.score).length;
  const series = Object.fromEntries(data.players.map((player) => [player, chartValuesForPlayer(data, player)]));
  const playedValues = Object.values(series).flat();
  const maxScore = Math.max(10, ...playedValues);
  const hasWinnerPoint = Boolean(data.winner?.actual);
  const pointCount = Math.max(1, Math.max(...Object.values(series).map((values) => values.length)));
  const pointsByPlayer = {};

  data.players.forEach((player) => {
    pointsByPlayer[player] = series[player].map((value, index) => ({
      value,
      x: padding + (index / Math.max(1, pointCount - 1)) * chartWidth,
      y: height - padding - (value / maxScore) * chartHeight,
    }));
  });

  chartState = {
    data,
    padding,
    pointCount,
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
  const { data, padding, pointCount, series, pointsByPlayer, hoveredPlayer } = chartState;
  const width = canvas.width;
  const height = canvas.height;
  const playedCount = data.matches.filter((match) => match.score).length;
  const playedValues = Object.values(series).flat();
  const maxScore = Math.max(10, ...playedValues);
  const hasWinnerPoint = Boolean(data.winner?.actual);

  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#d8e2d9";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(padding, padding);
  context.lineTo(padding, height - padding);
  context.lineTo(width - padding, height - padding);
  context.stroke();

  context.fillStyle = "#637069";
  context.font = "14px Arial";
  context.fillText("0", 16, height - padding + 4);
  context.fillText(String(maxScore), 12, padding + 4);
  context.fillText(hasWinnerPoint ? "Winner" : `Game ${playedCount}`, width - padding - 64, height - 16);

  data.players.forEach((player, playerIndex) => {
    const points = pointsByPlayer[player];
    const color = colors[playerIndex % colors.length];
    if (!points.length) return;

    context.globalAlpha = hoveredPlayer && hoveredPlayer !== player ? 0.18 : 1;
    context.strokeStyle = color;
    context.lineWidth = hoveredPlayer === player ? 4.5 : data.players.length > 5 ? 1.8 : 2.5;
    context.beginPath();

    points.forEach(({ x, y }, index) => {
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });

    context.stroke();
  });
  context.globalAlpha = 1;

  document.querySelector("#chartLegend").innerHTML = data.players.map((player, playerIndex) => {
    const values = series[player];
    const finalValue = values[values.length - 1] || 0;
    const stateClass = hoveredPlayer === player ? "is-active" : hoveredPlayer ? "is-muted" : "";
    return `<span class="${stateClass}" data-chart-player="${player}"><i style="background:${colors[playerIndex % colors.length]}"></i>${player}: ${finalValue}</span>`;
  }).join("");

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

function bindChartHover() {
  const canvas = document.querySelector("#progressChart");
  const legend = document.querySelector("#chartLegend");
  if (canvas.dataset.hoverBound) return;
  canvas.dataset.hoverBound = "true";

  canvas.addEventListener("mousemove", (event) => {
    if (!chartState) return;

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
      tooltip.textContent = `${player}: ${values[values.length - 1] || 0}`;
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

function groupedLeaderboards(data, field, label) {
  const values = sortValues([...new Set(data.matches.map((match) => match[field]))]);

  return `<div class="mini-board-grid">${
    values
    .map((value) => {
      const rows = rowsForMatches(data, data.matches.filter((match) => match[field] === value));
      return `
        <article class="mini-board">
          <div class="mini-heading">${label} ${value}</div>
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
    const latest = latestPlayedMatch(data);
    const rows = biggestMoverRows(data);
    html = latest
      ? `
        <p class="stat-note">Rank changes after ${latest.id}. ${latest.label}. Positive points are from that match only.</p>
        ${rows.length ? simpleTable(["Player", "Move", "From → To", "Points"], rows, ["player", "change", "fromTo", "points"]) : "<p class=\"stat-note\">No rank changes after the latest played match.</p>"}
      `
      : "<p class=\"stat-note\">No matches have been played yet.</p>";
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
}

fetch("/api/data")
  .then((response) => {
    if (!response.ok) throw new Error("Live data failed");
    return response.json();
  })
  .catch(() => fetch("data.json").then((response) => response.json()))
  .then((data) => {
    currentData = data;
    renderNextGame(data);
    renderLeaderboard(data);
    renderMatches(data);
    drawChart(data);
    renderSelectedStat(data);
    document.querySelector("#statPicker").addEventListener("change", () => renderSelectedStat(currentData));
  });
