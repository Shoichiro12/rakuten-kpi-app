"""楽天公式ジャンルマスタ（大/中/小の3階層に集約）をカテゴリ選択ピッカーへ供給する。

data/rakuten_genre_master.csv（cp932, 列: ディレクトリID,U1..U5,genre）を初回アクセス時に
一度だけ読み込み、U1/U2/U3 の distinct ツリー {U1: {U2: [U3,...]}} を作ってキャッシュする。
ProductCategory が大/中/小の3階層のため U4/U5 は畳む。

このマスタは楽天の公開ジャンル体系であり、全ユーザー共通の参照データ（テナント非依存・読み取り専用）。
DBには載せず、リポジトリ同梱のCSVからメモリに読む（起動を軽く保つため遅延ロード＋キャッシュ）。
"""
import csv
import io
import os
from functools import lru_cache

_CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "rakuten_genre_master.csv")


@lru_cache(maxsize=1)
def get_genre_tree() -> dict:
    """{U1: {U2: [U3,...]}} の3階層ツリーを返す（初回のみCSVを読み、以降はキャッシュ）。

    - U2 が空の大分類は {U1: {}}（中分類なし）。
    - U3 が空の中分類は {U2: []}（小分類なし）。
    ファイルが無い／読めない場合は空 dict を返す（画面は「自由入力」で機能を維持）。
    """
    try:
        with open(_CSV_PATH, "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        return {}

    text = None
    for enc in ("cp932", "shift_jis", "utf-8-sig", "utf-8"):
        try:
            text = raw.decode(enc)
            break
        except Exception:
            continue
    if text is None:
        return {}

    tree: dict = {}
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        u1 = (row.get("U1") or "").strip()
        u2 = (row.get("U2") or "").strip()
        u3 = (row.get("U3") or "").strip()
        if not u1:
            continue
        u2_map = tree.setdefault(u1, {})
        if u2:
            u3_set = u2_map.setdefault(u2, set())
            if u3:
                u3_set.add(u3)

    # set を並べ替えた list に変換して確定させる。
    return {
        u1: {u2: sorted(u3s) for u2, u3s in u2_map.items()}
        for u1, u2_map in tree.items()
    }
