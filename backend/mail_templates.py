# -*- coding: utf-8 -*-
"""メールの文面テンプレート。

計画書 docs/jisso_keikaku_comp_invite_2026-08-31.md §4。管理画面からの本文編集
機能は今回入れない（差し込みメッセージ message で不足を補う想定。必要になったら
別チケット）。プレーンテキストのみ（既存の通知メールと同じ方針。HTMLメールは作らない）。
"""

INVITE_SUBJECT = "【ウレシル】無償アカウントのご招待"


def invite_body(*, email: str, action_link: str, message: str, expires_label: str) -> str:
    """招待メールの本文を組み立てる。

    message が空文字/Noneのときは段落ごと消す（空行が残らないようにする）。
    """
    message = (message or "").strip()

    lines = [
        f"{email} 様",
        "",
        "楽天市場向けの売上・広告KPI管理ツール「ウレシル」の中村です。",
        f"{email} 様のアカウントを無償でご用意しましたので、ご案内します。",
    ]
    if message:
        lines += ["", message]
    lines += [
        "",
        "■ はじめかた",
        f"1. 下のリンクを開く（有効期限: 発行から{expires_label}）",
        f"   {action_link}",
        "2. パスワードを決めて保存する",
        "3. そのままダッシュボードが開きます",
        "",
        "■ ご利用について",
        "・費用はかかりません。カード登録も不要です",
        "・無償提供の終了時は、事前にこちらからご連絡します",
        "・使い方はアプリ内の「使い方ガイド」か、こちらをご覧ください",
        "  https://ureshiru.com/help.html",
        "",
        "ご不明な点はこのメールに返信いただくか、info@ureshiru.com までご連絡ください。",
        "",
        "--",
        "ウレシル（運営: 中村祥一郎）",
        "https://ureshiru.com",
        "利用規約 https://ureshiru.com/terms.html",
        "プライバシーポリシー https://ureshiru.com/privacy.html",
    ]
    return "\n".join(lines)
