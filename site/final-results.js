const excludedPlayerNames = new Set(["API Match ID", "Status"]);

function normalizeData(data) {
  const players = (data.players || []).filter((player) => !excludedPlayerNames.has(player));
  const playerSet = new Set(players);
  data.players = players;
  data.leaderboard = (data.leaderboard || []).filter((row) => playerSet.has(row.player));
  if (data.winner?.predictions) {
    data.winner.predictions = Object.fromEntries(Object.entries(data.winner.predictions).filter(([player]) => playerSet.has(player)));
  }
  data.matches = (data.matches || []).map((match) => ({
    ...match,
    points: Object.fromEntries(Object.entries(match.points || {}).filter(([player]) => playerSet.has(player))),
    predictions: Object.fromEntries(Object.entries(match.predictions || {}).filter(([player]) => playerSet.has(player))),
  }));
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function playedMatchesByDate(data) {
  return [...data.matches]
    .filter((match) => match.score)
    .sort((a, b) => new Date(`${a.date}T${a.time || "00:00"}:00+02:00`) - new Date(`${b.date}T${b.time || "00:00"}:00+02:00`) || a.id - b.id);
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

function parseScore(score) {
  const match = String(score || "").trim().match(/^(\d+)\s*-\s*(\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function predictionCounts(match) {
  const counts = new Map();
  Object.values(match.predictions || {})
    .filter(Boolean)
    .forEach((prediction) => counts.set(prediction, (counts.get(prediction) || 0) + 1));
  return counts;
}

function consensusPrediction(match) {
  const top = [...predictionCounts(match).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top?.[1] > 1 ? top[0] : "";
}

function playerStreak(matches, player, predicate) {
  let best = 0;
  let current = 0;
  matches.forEach((match) => {
    if (predicate(match.points[player] || 0)) {
      current += 1;
      best = Math.max(best, current);
      return;
    }
    current = 0;
  });
  return best;
}

function nearlyExact(prediction, actual) {
  if (!prediction || !actual) return false;
  if (prediction[0] === actual[0] && prediction[1] === actual[1]) return false;
  return Math.abs(prediction[0] - actual[0]) + Math.abs(prediction[1] - actual[1]) === 1;
}

function bestBy(rows, sort) {
  return [...rows].sort(sort)[0] || null;
}

function finalRows(data) {
  return rowsWithRanks(data.leaderboard)
    .map((row) => ({
      ...row,
      matchPoints: row.matchPoints ?? row.points - (row.winnerPoints || 0),
      winnerPoints: row.winnerPoints || 0,
    }));
}

function highlightCards(data) {
  const played = playedMatchesByDate(data);
  if (!played.length) return [];

  const gameRows = played.map((match) => ({
    label: `${match.id}. ${match.label}`,
    points: data.players.reduce((total, player) => total + (match.points[player] || 0), 0),
  }));
  const lowScoringGames = [...played]
    .map((match) => ({
      match,
      average: data.players.reduce((total, player) => total + (match.points[player] || 0), 0) / Math.max(1, data.players.length),
    }))
    .sort((a, b) => a.average - b.average || a.match.id - b.match.id)
    .slice(0, Math.max(1, Math.ceil(played.length * 0.3)))
    .map((row) => row.match);

  const rows = data.players.map((player) => {
    const points = played.map((match) => match.points[player] || 0);
    const totalPoints = points.reduce((total, value) => total + value, 0);
    const exactMatches = points.filter((value) => value >= 10).length;
    const exactPoints = points.reduce((total, value) => total + (value >= 10 ? value : 0), 0);
    const predictions = data.matches.filter((match) => match.predictions?.[player]);
    const consensusBreaks = predictions.filter((match) => {
      const consensus = consensusPrediction(match);
      return consensus && match.predictions[player] !== consensus;
    }).length;
    const lonelyPoints = played.reduce((total, match) => {
      const prediction = match.predictions?.[player] || "";
      return prediction && predictionCounts(match).get(prediction) === 1 ? total + (match.points[player] || 0) : total;
    }, 0);

    return {
      player,
      totalPoints,
      exactMatches,
      partialPoints: totalPoints - exactPoints,
      hotStreak: playerStreak(played, player, (points) => points > 0),
      coldStreak: playerStreak(played, player, (points) => points === 0),
      consensusBreaks,
      predictions: predictions.length,
      lonelyPoints,
      chaosPoints: lowScoringGames.reduce((total, match) => total + (match.points[player] || 0), 0),
      nearlyExactCount: played.reduce((total, match) => total + (nearlyExact(parseScore(match.predictions?.[player]), parseScore(match.score)) ? 1 : 0), 0),
    };
  });

  const bestGame = bestBy(gameRows, (a, b) => b.points - a.points || a.label.localeCompare(b.label));
  const hardestGame = bestBy(gameRows, (a, b) => a.points - b.points || a.label.localeCompare(b.label));
  const exact = bestBy(rows, (a, b) => b.exactMatches - a.exactMatches || b.totalPoints - a.totalPoints || a.player.localeCompare(b.player));
  const partial = bestBy(rows, (a, b) => b.partialPoints - a.partialPoints || b.totalPoints - a.totalPoints || a.player.localeCompare(b.player));
  const hot = bestBy(rows, (a, b) => b.hotStreak - a.hotStreak || b.totalPoints - a.totalPoints || a.player.localeCompare(b.player));
  const cold = bestBy(rows, (a, b) => b.coldStreak - a.coldStreak || a.totalPoints - b.totalPoints || a.player.localeCompare(b.player));
  const contrarian = bestBy(rows, (a, b) => b.consensusBreaks - a.consensusBreaks || b.predictions - a.predictions || a.player.localeCompare(b.player));
  const lonely = bestBy(rows, (a, b) => b.lonelyPoints - a.lonelyPoints || b.totalPoints - a.totalPoints || a.player.localeCompare(b.player));
  const chaos = bestBy(rows, (a, b) => b.chaosPoints - a.chaosPoints || b.totalPoints - a.totalPoints || a.player.localeCompare(b.player));
  const almost = bestBy(rows, (a, b) => b.nearlyExactCount - a.nearlyExactCount || b.totalPoints - a.totalPoints || a.player.localeCompare(b.player));

  return [
    { title: "Exact score artist", player: exact.player, value: `${exact.exactMatches}`, detail: "Exact scores" },
    { title: "Best partial scorer", player: partial.player, value: `${partial.partialPoints} pts`, detail: "Points without exact scores" },
    { title: "Hot streak", player: hot.player, value: `${hot.hotStreak} games`, detail: "Longest run with points" },
    { title: "Cold streak", player: cold.player, value: `${cold.coldStreak} games`, detail: "Longest run without points" },
    { title: "Consensus breaker", player: contrarian.player, value: `${contrarian.consensusBreaks} picks`, detail: "Predictions away from the crowd" },
    { title: "Lonely prophet", player: lonely.player, value: `${lonely.lonelyPoints} pts`, detail: "Points from unique predictions" },
    { title: "Chaos surfer", player: chaos.player, value: `${chaos.chaosPoints} pts`, detail: "Points in the lowest-scoring games" },
    { title: "Nearly nailed it", player: almost.player, value: `${almost.nearlyExactCount}`, detail: "Scores one goal away from exact" },
    { title: "Easiest game", player: "", value: `${bestGame.points} pts`, detail: bestGame.label },
    { title: "Hardest game", player: "", value: `${hardestGame.points} pts`, detail: hardestGame.label },
  ];
}

function renderSummary(data) {
  const played = playedMatchesByDate(data).length;
  const total = data.matches.length;
  const hasWinner = Boolean(data.winner?.actual);
  document.querySelector("#finalDataStatus").textContent = hasWinner
    ? `Final data from the Google Sheet: ${played}/${total} matches scored, winner ${data.winner.actual}.`
    : `Live data from the Google Sheet: ${played}/${total} matches scored. Winner points are not filled yet.`;
  document.querySelector("#finalSummary").innerHTML = `
    <span><b>${played}</b> scored games</span>
    <span><b>${data.players.length}</b> players</span>
    <span><b>${hasWinner ? escapeHtml(data.winner.actual) : "-"}</b> winner</span>
  `;
}

function renderPodium(data) {
  const medals = ["Gold", "Silver", "Bronze"];
  const rows = finalRows(data).slice(0, 3);
  document.querySelector("#finalPodium").innerHTML = rows.map((row, index) => `
    <article class="podium-card podium-${index + 1}">
      <div class="podium-medal">${medals[index]}</div>
      <div class="podium-rank">#${row.rank}</div>
      <h3>${escapeHtml(row.player)}</h3>
      <div class="podium-points">${row.points}</div>
      <div class="highlight-detail">${row.matchPoints} match pts${row.winnerPoints ? ` + ${row.winnerPoints} winner pts` : ""}</div>
    </article>
  `).join("");
}

function renderTable(data) {
  document.querySelector("#finalTable").innerHTML = `
    <table>
      <thead>
        <tr><th>#</th><th>Player</th><th>Total</th><th>Matches</th><th>Winner</th></tr>
      </thead>
      <tbody>
        ${finalRows(data).map((row) => `
          <tr>
            <td>${row.rank}</td>
            <td>${escapeHtml(row.player)}</td>
            <td><strong>${row.points}</strong></td>
            <td>${row.matchPoints}</td>
            <td>${row.winnerPoints}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderWinner(data) {
  const rows = data.players
    .map((player) => ({
      player,
      prediction: data.winner?.predictions?.[player]?.winner || "-",
      points: data.winner?.predictions?.[player]?.points || 0,
    }))
    .sort((a, b) => b.points - a.points || a.player.localeCompare(b.player));

  document.querySelector("#winnerPanel").innerHTML = `
    <p class="stat-note">${data.winner?.actual ? `Actual winner: ${escapeHtml(data.winner.actual)}` : "Actual winner not filled yet."}</p>
    <table>
      <thead><tr><th>Player</th><th>Prediction</th><th>Points</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.player)}</td>
            <td>${escapeHtml(row.prediction)}</td>
            <td><strong>${row.points}</strong></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderHighlights(data) {
  const cards = highlightCards(data);
  document.querySelector("#finalHighlights").innerHTML = cards.length ? `
    <div class="highlight-grid final-highlight-grid">
      ${cards.map((card) => `
        <article class="highlight-card">
          <div class="highlight-title">${escapeHtml(card.title)}</div>
          ${card.player ? `<div class="highlight-player">${escapeHtml(card.player)}</div>` : ""}
          <div class="highlight-value">${escapeHtml(card.value)}</div>
          <div class="highlight-detail">${escapeHtml(card.detail)}</div>
        </article>
      `).join("")}
    </div>
  ` : `<p class="stat-note">Highlights will appear once games have been scored.</p>`;
}

function renderFinalResults(data) {
  renderSummary(data);
  renderPodium(data);
  renderTable(data);
  renderWinner(data);
  renderHighlights(data);
}

fetch("/api/data")
  .then((response) => {
    if (!response.ok) throw new Error("Live data failed");
    return response.json();
  })
  .catch(() => fetch("data.json").then((response) => response.json()))
  .then((data) => renderFinalResults(normalizeData(data)))
  .catch((error) => {
    console.error("Final results failed", error);
    document.querySelector("#finalDataStatus").textContent = "Could not load final results data.";
  });
