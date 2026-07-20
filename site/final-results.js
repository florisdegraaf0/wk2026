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

function rankedPointRows(rows) {
  return rowsWithRanks([...rows].sort((a, b) => b.points - a.points || a.player.localeCompare(b.player)));
}

function rankByPlayer(rows) {
  return Object.fromEntries(rows.map((row) => [row.player, row.rank]));
}

function matchOnlyRows(data) {
  return rankedPointRows(data.players.map((player) => {
    const row = data.leaderboard.find((item) => item.player === player);
    return {
      player,
      points: row?.matchPoints ?? (row?.points || 0) - (row?.winnerPoints || 0),
    };
  }));
}

function winnerBonusPoints(data, player) {
  return data.winner?.actual ? data.winner.predictions?.[player]?.points || 0 : 0;
}

function finalGameGain(data, match, player) {
  return (match?.points?.[player] || 0) + winnerBonusPoints(data, player);
}

function playerReportRows(data) {
  const played = playedMatchesByDate(data);
  if (!played.length) return [];

  const lowScoringGames = [...played]
    .map((match) => ({
      match,
      average: data.players.reduce((total, player) => total + (match.points[player] || 0), 0) / Math.max(1, data.players.length),
    }))
    .sort((a, b) => a.average - b.average || a.match.id - b.match.id)
    .slice(0, Math.max(1, Math.ceil(played.length * 0.3)))
    .map((row) => row.match);

  return data.players.map((player) => {
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
}

function gameReportRows(data) {
  return playedMatchesByDate(data).map((match) => ({
    label: `${match.id}. ${match.label}`,
    score: match.score,
    points: data.players.reduce((total, player) => total + (match.points[player] || 0), 0),
    exact: data.players.filter((player) => (match.points[player] || 0) >= 10).length,
  }));
}

function finalReportHighlights(data) {
  const played = playedMatchesByDate(data);
  if (!played.length) return [];

  const finalLeaderboard = finalRows(data);
  const matchRows = matchOnlyRows(data);
  const playerStats = playerReportRows(data);
  const games = gameReportRows(data);
  const champion = finalLeaderboard[0];
  const runnerUp = finalLeaderboard[1];
  const third = finalLeaderboard[2];
  const matchLeader = matchRows[0];
  const exact = bestBy(playerStats, (a, b) => b.exactMatches - a.exactMatches || b.totalPoints - a.totalPoints || a.player.localeCompare(b.player));
  const partial = bestBy(playerStats, (a, b) => b.partialPoints - a.partialPoints || b.totalPoints - a.totalPoints || a.player.localeCompare(b.player));
  const hot = bestBy(playerStats, (a, b) => b.hotStreak - a.hotStreak || b.totalPoints - a.totalPoints || a.player.localeCompare(b.player));
  const cold = bestBy(playerStats, (a, b) => b.coldStreak - a.coldStreak || a.totalPoints - b.totalPoints || a.player.localeCompare(b.player));
  const contrarian = bestBy(playerStats, (a, b) => b.consensusBreaks - a.consensusBreaks || b.predictions - a.predictions || a.player.localeCompare(b.player));
  const lonely = bestBy(playerStats, (a, b) => b.lonelyPoints - a.lonelyPoints || b.totalPoints - a.totalPoints || a.player.localeCompare(b.player));
  const chaos = bestBy(playerStats, (a, b) => b.chaosPoints - a.chaosPoints || b.totalPoints - a.totalPoints || a.player.localeCompare(b.player));
  const almost = bestBy(playerStats, (a, b) => b.nearlyExactCount - a.nearlyExactCount || b.totalPoints - a.totalPoints || a.player.localeCompare(b.player));
  const bestGame = bestBy(games, (a, b) => b.points - a.points || a.label.localeCompare(b.label));
  const hardestGame = bestBy(games, (a, b) => a.points - b.points || a.label.localeCompare(b.label));
  const exactGame = bestBy(games, (a, b) => b.exact - a.exact || b.points - a.points || a.label.localeCompare(b.label));
  const finalMatch = played[played.length - 1];
  const finalGains = data.players
    .map((player) => ({
      player,
      matchPoints: finalMatch?.points?.[player] || 0,
      winnerPoints: winnerBonusPoints(data, player),
      points: finalGameGain(data, finalMatch, player),
    }))
    .sort((a, b) => b.points - a.points || a.player.localeCompare(b.player));
  const previousRows = rankedPointRows(data.players.map((player) => ({
    player,
    points: (data.leaderboard.find((row) => row.player === player)?.points || 0) - finalGameGain(data, finalMatch, player),
  })));
  const previousRanks = rankByPlayer(previousRows);
  const currentRanks = rankByPlayer(finalLeaderboard);
  const finalMoves = data.players
    .map((player) => ({
      player,
      from: previousRanks[player],
      to: currentRanks[player],
      movement: previousRanks[player] - currentRanks[player],
      points: finalGameGain(data, finalMatch, player),
    }))
    .filter((row) => row.movement !== 0)
    .sort((a, b) => Math.abs(b.movement) - Math.abs(a.movement) || b.movement - a.movement || a.player.localeCompare(b.player));
  const bonusPlayers = data.players
    .filter((player) => winnerBonusPoints(data, player) > 0)
    .sort((a, b) => a.localeCompare(b));
  const podiumGap = third ? champion.points - third.points : 0;
  const titleGap = runnerUp ? champion.points - runnerUp.points : 0;

  return [
    {
      title: `A ${titleGap}-point title race`,
      body: `${champion.player} finished on ${champion.points} points, only ${titleGap} ahead of ${runnerUp.player}. The entire podium was squeezed into ${podiumGap} points, with ${third.player} close behind on ${third.points}.`,
    },
    {
      title: "The winner bonus changed the shape of the table",
      body: data.winner?.actual
        ? `${data.winner.actual} decided the pool as much as the final itself. ${bonusPlayers.length ? bonusPlayers.join(", ") : "Nobody"} picked the winner and collected the ${data.winner.points}-point bonus. Without that bonus, ${matchLeader.player} would have led the match-only table on ${matchLeader.points} points.`
        : "The tournament winner is not filled yet, so the winner bonus is still waiting to land.",
    },
    {
      title: "Final-game drama",
      body: `${finalMatch.label} ended ${finalMatch.score} and was worth the last big shake-up. ${finalGains[0].player} gained ${finalGains[0].points} points in the deciding package: ${finalGains[0].matchPoints} from the final score${finalGains[0].winnerPoints ? ` and ${finalGains[0].winnerPoints} from the winner bonus` : ""}.${finalMoves.length ? ` Biggest rank move: ${finalMoves[0].player} went from #${finalMoves[0].from} to #${finalMoves[0].to}.` : " No ranks changed after the last game."}`,
    },
    {
      title: "Precision prize",
      body: `${exact.player} was the exact-score specialist with ${exact.exactMatches} perfect predictions. ${almost.player} had the most near misses, landing one goal away from exact ${almost.nearlyExactCount} times.`,
    },
    {
      title: "Grinding out points",
      body: `${partial.player} was the best partial scorer, collecting ${partial.partialPoints} points without needing exact scores. That is the unglamorous route, but it keeps you alive for ${played.length} games.`,
    },
    {
      title: "Runs, droughts, and stubbornness",
      body: `${hot.player} had the hottest streak with points in ${hot.hotStreak} consecutive games. ${cold.player} had the longest cold spell at ${cold.coldStreak} games, while ${contrarian.player} broke away from the consensus most often with ${contrarian.consensusBreaks} different picks.`,
    },
    {
      title: "The strange points",
      body: `${lonely.player} scored ${lonely.lonelyPoints} points from unique predictions, and ${chaos.player} handled the lowest-scoring games best with ${chaos.chaosPoints} points in the hardest slice of the tournament.`,
    },
    {
      title: "Games everyone remembers differently",
      body: `${bestGame.label} (${bestGame.score}) was the friendliest game for the pool with ${bestGame.points} total points. ${hardestGame.label} (${hardestGame.score}) was the trap game with only ${hardestGame.points}. The biggest exact-score party was ${exactGame.label}, with ${exactGame.exact} perfect picks.`,
    },
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
  const highlights = finalReportHighlights(data);
  document.querySelector("#finalHighlights").innerHTML = highlights.length ? `
    <div class="final-report">
      ${highlights.map((highlight) => `
        <article class="final-report-item">
          <h3>${escapeHtml(highlight.title)}</h3>
          <p>${escapeHtml(highlight.body)}</p>
        </article>
      `).join("")}
    </div>
  ` : `<p class="stat-note">Highlights will appear once games have been scored.</p>`;
}

function scaleValue(value, min, max, low = 8, high = 92) {
  if (max === min) return (low + high) / 2;
  return low + ((value - min) / (max - min)) * (high - low);
}

function playerInitials(name) {
  const parts = String(name || "")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length <= 1) return (parts[0] || "").slice(0, 2).toUpperCase();
  return parts.map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function renderScoringPatterns(data) {
  const stats = playerReportRows(data);
  if (!stats.length) {
    document.querySelector("#scoringPatterns").innerHTML = `<p class="stat-note">Scoring patterns will appear once games have been scored.</p>`;
    return;
  }

  const finalByPlayer = Object.fromEntries(finalRows(data).map((row) => [row.player, row]));
  const rows = stats.map((row) => ({
    ...row,
    finalPoints: finalByPlayer[row.player]?.points || row.totalPoints,
    winnerPoints: finalByPlayer[row.player]?.winnerPoints || 0,
  }));
  const exactValues = rows.map((row) => row.exactMatches);
  const consensusValues = rows.map((row) => row.consensusBreaks);
  const pointValues = rows.map((row) => row.finalPoints);
  const minExact = Math.min(...exactValues);
  const maxExact = Math.max(...exactValues);
  const minConsensus = Math.min(...consensusValues);
  const maxConsensus = Math.max(...consensusValues);
  const minPoints = Math.min(...pointValues);
  const maxPoints = Math.max(...pointValues);
  const sortedRows = [...rows].sort((a, b) => b.finalPoints - a.finalPoints || a.player.localeCompare(b.player));

  document.querySelector("#scoringPatterns").innerHTML = `
    <p class="stat-note">X-axis: exact scores. Y-axis: picks away from the crowd. Bigger dots finished with more points; orange rings collected the winner bonus.</p>
    <div class="pattern-plot" role="img" aria-label="Scatter plot of exact scores against consensus-breaking picks by player">
      <div class="pattern-axis pattern-axis-x">Exact scores</div>
      <div class="pattern-axis pattern-axis-y">Different picks</div>
      ${rows.map((row) => {
        const x = scaleValue(row.exactMatches, minExact, maxExact);
        const y = 100 - scaleValue(row.consensusBreaks, minConsensus, maxConsensus);
        const size = Math.round(scaleValue(row.finalPoints, minPoints, maxPoints, 20, 34));
        return `
          <div class="pattern-dot${row.winnerPoints ? " pattern-dot-bonus" : ""}" style="left: ${x}%; top: ${y}%; width: ${size}px; height: ${size}px;" title="${escapeHtml(row.player)}: ${row.exactMatches} exact, ${row.consensusBreaks} different picks, ${row.finalPoints} points" aria-label="${escapeHtml(row.player)}: ${row.exactMatches} exact, ${row.consensusBreaks} different picks, ${row.finalPoints} points">
            <span>${escapeHtml(playerInitials(row.player))}</span>
          </div>
        `;
      }).join("")}
    </div>
    <div class="pattern-summary">
      ${sortedRows.map((row) => `
        <span><b>${escapeHtml(playerInitials(row.player))}</b> ${escapeHtml(row.player)}: ${row.exactMatches} exact, ${row.consensusBreaks} different, ${row.finalPoints} pts</span>
      `).join("")}
    </div>
  `;
}

function renderFinalResults(data) {
  renderSummary(data);
  renderPodium(data);
  renderHighlights(data);
  renderScoringPatterns(data);
  renderTable(data);
  renderWinner(data);
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
