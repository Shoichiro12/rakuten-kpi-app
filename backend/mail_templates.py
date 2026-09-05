# -*- coding: utf-8 -*-
"""メールの文面テンプレート。

計画書 docs/jisso_keikaku_comp_invite_2026-08-31.md §4。管理画面からの本文編集
機能は今回入れない（差し込みメッセージ message で不足を補う想定。必要になったら
別チケット）。

招待メールは 2026-09-01 の軍令（`docs/office_map.html` QUESTS「招待メールをHTML化・
自社ドメインリンク化すること」）により、テキスト＋HTMLの2部構成にした。テキスト版
（`invite_body_text`）は従来どおり本文中に1行でリンクを出す（管理画面のプレビュー
＝`AdminAccounts.tsx` の `buildInvitePreview()` はこのテキスト版のみを移植している。
プレビューは今回もテキスト版のまま）。HTML版（`invite_body_html`）だけボタン
（「アカウントを有効化する」）＋予備のURL1行を追加する。
"""
import html as _html

INVITE_SUBJECT = "【ウレシル】無償アカウントのご招待"


def invite_body_text(*, email: str, invite_link: str, message: str, expires_label: str) -> str:
    """招待メールの本文（テキスト版）を組み立てる。

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
        f"   {invite_link}",
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


def invite_body_html(*, email: str, invite_link: str, message: str, expires_label: str) -> str:
    """招待メールの本文（HTML版）を組み立てる。

    「アカウントを有効化する」ボタン＋予備のURL1行（コピペ用）を持つ。メールクライアントの
    対応幅が広くない環境向けに、インラインCSS・テーブルレイアウトのみを使う（外部CSS・
    web fontは使わない）。文面自体はテキスト版と同じ内容にする。
    """
    message = (message or "").strip()
    e = _html.escape(email)
    link = _html.escape(invite_link, quote=True)
    exp = _html.escape(expires_label)

    message_html = ""
    if message:
        # ユーザーが入力した自由記述のため、必ずエスケープしてから改行だけ<br>に変換する
        escaped = _html.escape(message).replace("\n", "<br>")
        message_html = f'<p style="margin:16px 0 0;white-space:pre-wrap;">{escaped}</p>'

    return f"""<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f1ea;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fdfcf9;border-radius:12px;">
<tr><td style="padding:32px 28px;font-family:'Hiragino Sans','Yu Gothic',sans-serif;font-size:14px;line-height:1.85;color:#2e2d29;">
<p style="margin:0;">{e} 様</p>
<p style="margin:12px 0 0;">楽天市場向けの売上・広告KPI管理ツール「ウレシル」の中村です。</p>
<p style="margin:8px 0 0;">{e} 様のアカウントを無償でご用意しましたので、ご案内します。</p>
{message_html}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
<tr><td style="border-radius:8px;background:#2e2d29;">
<a href="{link}" style="display:inline-block;padding:13px 32px;color:#ffffff;font-weight:bold;text-decoration:none;border-radius:8px;font-size:14px;">アカウントを有効化する</a>
</td></tr>
</table>
<p style="margin:8px 0 0;font-size:12px;color:#6b6559;">
有効期限: 発行から{exp}。ボタンが開けない場合は、次のURLをブラウザのアドレス欄に貼り付けてください。<br>
<a href="{link}" style="color:#4c6850;word-break:break-all;">{link}</a>
</p>
<p style="margin:20px 0 0;">パスワードを決めて保存すると、そのままダッシュボードが開きます。</p>
<p style="margin:20px 0 0;font-weight:bold;">■ ご利用について</p>
<p style="margin:4px 0 0;">
・費用はかかりません。カード登録も不要です<br>
・無償提供の終了時は、事前にこちらからご連絡します<br>
・使い方はアプリ内の「使い方ガイド」か、<a href="https://ureshiru.com/help.html" style="color:#4c6850;">こちら</a>をご覧ください
</p>
<p style="margin:20px 0 0;">ご不明な点はこのメールに返信いただくか、info@ureshiru.com までご連絡ください。</p>
<hr style="margin:24px 0 12px;border:none;border-top:1px solid #e5dfd4;">
<p style="margin:0;font-size:12px;color:#6b6559;">
ウレシル（運営: 中村祥一郎）<br>
<a href="https://ureshiru.com" style="color:#6b6559;">https://ureshiru.com</a><br>
<a href="https://ureshiru.com/terms.html" style="color:#6b6559;">利用規約</a>
<a href="https://ureshiru.com/privacy.html" style="color:#6b6559;">プライバシーポリシー</a>
</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""
