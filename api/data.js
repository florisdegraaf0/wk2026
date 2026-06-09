const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1fozCeduyiHd2W66pqQHGKjAPH5zBtczB24yjBeGOyK8";
const WINNER_POINTS = 50;
const MATCH_COLUMNS = new Set(["Datum", "Tijd", "ID", "Country_1", "Country_2", "Group", "Round", "Score"]);

function parseScore(score) {
  if (score === null || score === undefined || score === "") return null;
  const match = String(score).trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function formatScore(score) {
  const parsed = parseScore(score);
  return parsed ? `${parsed[0]}-${parsed[1]}` : "";
}

function formatValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function excelDateToIso(serial) {
  const days = Number(serial);
  if (!Number.isFinite(days)) return "";
  const date = new Date(Date.UTC(1899, 11, 30 + Math.floor(days)));
  return date.toISOString().slice(0, 10);
}

function gvizDateArgs(value) {
  const match = String(value).trim().match(/^Date\(([^)]+)\)/);
  return match ? match[1].split(",").map((part) => Number(part.trim())) : null;
}

function formatDate(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return excelDateToIso(value);
  const text = String(value).trim();
  const dateArgs = gvizDateArgs(text);
  if (dateArgs) {
    return new Date(Date.UTC(dateArgs[0], dateArgs[1], dateArgs[2])).toISOString().slice(0, 10);
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 10);
}

function formatTime(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    const minutes = Math.round(value * 24 * 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const text = String(value).trim();
  const dateArgs = gvizDateArgs(text);
  if (dateArgs && dateArgs.length >= 5) {
    return `${String(dateArgs[3]).padStart(2, "0")}:${String(dateArgs[4]).padStart(2, "0")}`;
  }
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${String(Number(match[1])).padStart(2, "0")}:${match[2]}` : text;
}

function resultType(score) {
  if (score[0] > score[1]) return "home";
  if (score[1] > score[0]) return "away";
  return "draw";
}

function calculatePoints(prediction, actualScore) {
  const pred = parseScore(prediction);
  const actual = parseScore(actualScore);
  if (!pred || !actual) return 0;

  const exactScore = pred[0] === actual[0] && pred[1] === actual[1];
  const correctResult = resultType(pred) === resultType(actual);
  const correctOneTeamGoals = pred[0] === actual[0] || pred[1] === actual[1];

  if (exactScore) return 10;
  if (correctResult && correctOneTeamGoals) return 7;
  if (correctResult) return 5;
  if (correctOneTeamGoals) return 2;
  return 0;
}

async function readSheet(sheetName) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`);
  url.searchParams.set("tqx", "out:json");
  url.searchParams.set("sheet", sheetName);
  url.searchParams.set("_", String(Date.now()));

  const response = await fetch(url, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`Could not read sheet ${sheetName}: ${response.status}`);

  const text = await response.text();
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  return {
    headers: json.table.cols.map((column) => String(column.label || "").trim()),
    rows: json.table.rows.map((row) => row.c.map((cell) => cell?.v ?? "")),
  };
}

function rowsToObjects(sheet) {
  const headers = sheet.headers;
  return sheet.rows
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])))
    .filter((row) => row.ID !== "" && row.Country_1 !== "" && row.Country_2 !== "");
}

function readWinnerPredictions(rows) {
  if (rows.length < 2) return ["", {}];
  const actualWinner = formatValue(rows[1][0]);
  const predictions = {};

  rows[0].slice(1).forEach((player, index) => {
    if (!player) return;
    predictions[formatValue(player)] = formatValue(rows[1][index + 1]);
  });

  return [actualWinner, predictions];
}

async function buildData() {
  const [matchRows, winnerRows] = await Promise.all([readSheet("Blad1"), readSheet("winner")]);
  const matchesInput = rowsToObjects(matchRows);
  const matchPlayers = Object.keys(matchesInput[0] || {}).filter((column) => !MATCH_COLUMNS.has(column) && !column.startsWith("Unnamed"));
  const [actualWinner, winnerPredictions] = readWinnerPredictions(winnerRows.rows);
  const players = [...matchPlayers];

  Object.keys(winnerPredictions).forEach((player) => {
    if (!players.includes(player)) players.push(player);
  });

  const matches = [];
  const matchTotals = Object.fromEntries(players.map((player) => [player, 0]));
  const progress = Object.fromEntries(players.map((player) => [player, []]));

  matchesInput.forEach((row) => {
    const score = formatScore(row.Score);
    const match = {
      id: Number(row.ID),
      label: `${row.Country_1} - ${row.Country_2}`,
      country1: String(row.Country_1),
      country2: String(row.Country_2),
      date: formatDate(row.Datum),
      time: formatTime(row.Tijd),
      group: formatValue(row.Group),
      round: formatValue(row.Round),
      score,
      points: {},
      predictions: {},
    };

    players.forEach((player) => {
      const prediction = row[player] ?? "";
      const points = calculatePoints(prediction, row.Score);
      matchTotals[player] += points;
      progress[player].push(score ? matchTotals[player] : null);
      match.points[player] = points;
      match.predictions[player] = formatScore(prediction);
    });

    matches.push(match);
  });

  const winner = {
    actual: actualWinner,
    points: WINNER_POINTS,
    predictions: {},
  };

  const leaderboard = players.map((player) => {
    const prediction = winnerPredictions[player] || "";
    const winnerPoints = actualWinner && prediction.toLocaleLowerCase() === actualWinner.toLocaleLowerCase() ? WINNER_POINTS : 0;
    winner.predictions[player] = { winner: prediction, points: winnerPoints };

    return {
      player,
      points: matchTotals[player] + winnerPoints,
      matchPoints: matchTotals[player],
      winnerPoints,
    };
  }).sort((a, b) => b.points - a.points || a.player.localeCompare(b.player));

  return {
    generatedAt: new Date().toISOString().slice(0, 19),
    source: "Google Sheets",
    players,
    matches,
    winner,
    leaderboard,
    progress,
  };
}

module.exports = async function handler(request, response) {
  try {
    const data = await buildData();
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json(data);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
};
