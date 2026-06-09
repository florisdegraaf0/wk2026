import json
import os
import re
from io import BytesIO
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

import pandas as pd


ROOT = Path(__file__).parent
INPUT_FILE = ROOT / "input.xlsx"
OUTPUT_FILE = ROOT / "site" / "data.json"
WINNER_POINTS = 50
GOOGLE_SHEET_ID = os.environ.get("GOOGLE_SHEET_ID", "1fozCeduyiHd2W66pqQHGKjAPH5zBtczB24yjBeGOyK8")
GOOGLE_SHEET_EXPORT_URL = f"https://docs.google.com/spreadsheets/d/{GOOGLE_SHEET_ID}/export?format=xlsx"
MATCH_COLUMNS = {"Datum", "Tijd", "ID", "Country_1", "Country_2", "Group", "Round", "Score"}


def parse_score(score):
    if pd.isna(score):
        return None

    match = re.match(r"^(\d+)\s*-\s*(\d+)$", str(score).strip())
    if not match:
        return None

    return int(match.group(1)), int(match.group(2))


def format_score(score):
    parsed = parse_score(score)
    if parsed is None:
        return ""
    return f"{parsed[0]}-{parsed[1]}"


def format_value(value):
    if pd.isna(value):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def format_date(value):
    if pd.isna(value):
        return ""
    try:
        return pd.to_datetime(value).date().isoformat()
    except (TypeError, ValueError):
        return str(value).strip()


def format_time(value):
    if pd.isna(value):
        return ""
    if hasattr(value, "strftime"):
        return value.strftime("%H:%M")
    try:
        return pd.to_datetime(value).strftime("%H:%M")
    except (TypeError, ValueError):
        text = str(value).strip()
        match = re.match(r"^(\d{1,2}):(\d{2})", text)
        return f"{int(match.group(1)):02d}:{match.group(2)}" if match else text


def result_type(score):
    home, away = score
    if home > away:
        return "home"
    if away > home:
        return "away"
    return "draw"


def calculate_points(prediction, actual_score):
    pred = parse_score(prediction)
    actual = parse_score(actual_score)

    if pred is None or actual is None:
        return 0

    exact_score = pred == actual
    correct_result = result_type(pred) == result_type(actual)
    correct_one_team_goals = pred[0] == actual[0] or pred[1] == actual[1]

    if exact_score:
        return 10
    if correct_result and correct_one_team_goals:
        return 7
    if correct_result:
        return 5
    if correct_one_team_goals:
        return 2
    return 0


def open_input_workbook():
    if os.environ.get("USE_LOCAL_INPUT") == "1":
        return pd.ExcelFile(INPUT_FILE)

    try:
        with urlopen(GOOGLE_SHEET_EXPORT_URL, timeout=30) as response:
            return pd.ExcelFile(BytesIO(response.read()))
    except (OSError, URLError) as error:
        if INPUT_FILE.exists():
            print(f"Could not download Google Sheet, using {INPUT_FILE.name}: {error}")
            return pd.ExcelFile(INPUT_FILE)
        raise


def read_winner_predictions(workbook):
    try:
        winner_df = pd.read_excel(workbook, sheet_name="winner", header=None)
    except ValueError:
        return "", {}

    if winner_df.empty or len(winner_df) < 2:
        return "", {}

    actual_winner = "" if pd.isna(winner_df.iloc[1, 0]) else str(winner_df.iloc[1, 0]).strip()
    predictions = {}

    for column in range(1, winner_df.shape[1]):
        player = winner_df.iloc[0, column]
        prediction = winner_df.iloc[1, column]
        if pd.isna(player):
            continue
        predictions[str(player).strip()] = "" if pd.isna(prediction) else str(prediction).strip()

    return actual_winner, predictions


def build_data():
    workbook = open_input_workbook()
    df = pd.read_excel(workbook, sheet_name="Blad1")
    df = df[df["ID"].notna() & df["Country_1"].notna() & df["Country_2"].notna()]
    match_players = [str(column) for column in df.columns if str(column) not in MATCH_COLUMNS and not str(column).startswith("Unnamed")]
    actual_winner, winner_predictions = read_winner_predictions(workbook)
    players = list(match_players)
    for player in winner_predictions:
        if player not in players:
            players.append(player)

    matches = []
    match_totals = {player: 0 for player in players}
    progress = {player: [] for player in players}

    for _, row in df.iterrows():
        score = format_score(row["Score"])
        match = {
            "id": int(row["ID"]),
            "label": f"{row['Country_1']} - {row['Country_2']}",
            "country1": str(row["Country_1"]),
            "country2": str(row["Country_2"]),
            "date": format_date(row["Datum"]) if "Datum" in df.columns else "",
            "time": format_time(row["Tijd"]) if "Tijd" in df.columns else "",
            "group": format_value(row["Group"]),
            "round": format_value(row["Round"]),
            "score": score,
            "points": {},
            "predictions": {},
        }

        for player in players:
            prediction = row[player] if player in df.columns else None
            points = calculate_points(prediction, row["Score"])
            match_totals[player] += points
            progress[player].append(match_totals[player] if score else None)
            match["points"][player] = points
            match["predictions"][player] = format_score(prediction)

        matches.append(match)

    winner = {
        "actual": actual_winner,
        "points": WINNER_POINTS,
        "predictions": {},
    }
    total_points = {}

    for player in players:
        prediction = winner_predictions.get(player, "")
        winner_points = WINNER_POINTS if actual_winner and prediction.casefold() == actual_winner.casefold() else 0
        winner["predictions"][player] = {
            "winner": prediction,
            "points": winner_points,
        }
        total_points[player] = match_totals[player] + winner_points

    leaderboard = sorted(
        [{"player": player, "points": points, "matchPoints": match_totals[player], "winnerPoints": winner["predictions"][player]["points"]} for player, points in total_points.items()],
        key=lambda row: (-row["points"], row["player"]),
    )

    return {
        "generatedAt": pd.Timestamp.now().isoformat(timespec="seconds"),
        "source": "Google Sheets" if os.environ.get("USE_LOCAL_INPUT") != "1" else INPUT_FILE.name,
        "players": players,
        "matches": matches,
        "winner": winner,
        "leaderboard": leaderboard,
        "progress": progress,
    }


def main():
    OUTPUT_FILE.parent.mkdir(exist_ok=True)
    data = build_data()
    OUTPUT_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
