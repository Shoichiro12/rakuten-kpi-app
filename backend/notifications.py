# -*- coding: utf-8 -*-
"""メール通知（SMTP）。

用途はコンサル問い合わせとアプリ内フィードバックの受信通知。問い合わせの一次チャネルが
このメールなので「届かないより、遅れても届く」を優先し、送信失敗はログに
残すだけで例外を上げない（フォーム送信自体は成功させる）。

必要な環境変数（未設定ならスキップして警告ログのみ。設定前でも動作確認できる）:
    SMTP_HOST      例: smtp.gmail.com
    SMTP_PORT      例: 587
    SMTP_USER      送信元メールアドレス
    SMTP_PASSWORD  Gmailはアプリパスワード（通常のログインパスワードでは送れない）
    NOTIFY_EMAIL   通知の宛先（SMTP_USER と同じでよい）
"""
import logging
import os
import smtplib
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.utils import formataddr

logger = logging.getLogger("notifications")

_JST = timezone(timedelta(hours=9))


def _env(key: str) -> str:
    return (os.environ.get(key) or "").strip()


def _fmt_jst(dt) -> str:
    """DBに入っているUTC日時（naive想定）をJST表記の文字列にする。

    メールを受け取った側が「今の話か」を即断できるようJSTで表示する。
    datetime以外（None・文字列など）はそのまま文字列化して返す。
    """
    if dt is None:
        return "（なし）"
    if not isinstance(dt, datetime):
        return str(dt)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_JST).strftime("%Y-%m-%d %H:%M:%S") + " (JST)"


def smtp_configured() -> bool:
    """SMTP送信に必要な env が揃っているか。"""
    return all(_env(k) for k in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "NOTIFY_EMAIL"))


def _send(subject: str, body: str) -> None:
    """プレーンテキストメールを NOTIFY_EMAIL 宛に送る。例外は呼び出し元へ伝播する。"""
    host = _env("SMTP_HOST")
    port = int(_env("SMTP_PORT") or 587)
    user = _env("SMTP_USER")
    password = _env("SMTP_PASSWORD")
    to = _env("NOTIFY_EMAIL")

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = formataddr(("ウレシル", user))
    msg["To"] = to

    with smtplib.SMTP(host, port, timeout=20) as server:
        server.starttls()
        server.login(user, password)
        server.sendmail(user, [to], msg.as_string())


def send_inquiry_notification(inquiry) -> None:
    """コンサル問い合わせの内容を NOTIFY_EMAIL 宛に送信する。

    送信失敗・env未設定でも例外は上げない（フォーム送信を失敗させないため）。
    引数は models.ConsultingInquiry（属性アクセスのみなので型注釈は緩くしている）。
    """
    if not smtp_configured():
        logger.warning(
            "SMTPが未設定のため問い合わせ通知メールをスキップしました "
            "(SMTP_HOST/SMTP_USER/SMTP_PASSWORD/NOTIFY_EMAIL): company=%s email=%s",
            getattr(inquiry, "company_name", None),
            getattr(inquiry, "contact_email", None),
        )
        return

    def v(attr: str) -> str:
        val = getattr(inquiry, attr, None)
        return str(val) if val not in (None, "") else "（未入力）"

    subject = f"【コンサル問い合わせ】{v('company_name')} 様"
    body = "\n".join([
        "コンサルの問い合わせが届きました。",
        "",
        f"お名前　　　: {v('name')}",
        f"会社名　　　: {v('company_name')}",
        f"規模感　　　: {v('scale_hint')}",
        f"連絡先メール: {v('contact_email')}",
        f"連絡先電話　: {v('contact_phone')}",
        "",
        "メッセージ:",
        v("message"),
        "",
        "-" * 40,
        f"問い合わせID: {getattr(inquiry, 'id', None)}",
        f"ユーザーID　: {getattr(inquiry, 'user_id', None)}",
        f"受信日時　　: {_fmt_jst(getattr(inquiry, 'created_at', None))}",
    ])

    try:
        _send(subject, body)
        logger.info(
            "問い合わせ通知メールを送信しました: id=%s to=%s",
            getattr(inquiry, "id", None), _env("NOTIFY_EMAIL"),
        )
    except Exception as e:
        # ここで落とすとフォーム送信がユーザー側でエラーになるため、ログのみ。
        logger.error("問い合わせ通知メールの送信に失敗しました: %s", e, exc_info=True)


_FEEDBACK_CATEGORY_LABELS = {
    "bug": "不具合の報告",
    "request": "改善の要望",
    "other": "その他",
    "cancel": "解約について",
}


def send_feedback_notification(feedback) -> None:
    """アプリ内フィードバックの内容を NOTIFY_EMAIL 宛に送信する。

    問い合わせ通知と同じ方針: 送信失敗・env未設定でも例外は上げない。
    引数は models.Feedback。
    """
    if not smtp_configured():
        logger.warning(
            "SMTPが未設定のためフィードバック通知メールをスキップしました: id=%s category=%s",
            getattr(feedback, "id", None),
            getattr(feedback, "category", None),
        )
        return

    def v(attr: str) -> str:
        val = getattr(feedback, attr, None)
        return str(val) if val not in (None, "") else "（なし）"

    category = _FEEDBACK_CATEGORY_LABELS.get(
        getattr(feedback, "category", ""), getattr(feedback, "category", "不明"))
    # 解約リクエストは2〜3営業日以内の手続き完了を約束している運用のため、
    # 他のフィードバックに埋もれないよう件名を必ず【解約リクエスト】で始める
    if getattr(feedback, "category", "") == "cancel":
        subject = f"【解約リクエスト】ウレシル: {v('user_email')}"
    else:
        subject = f"【ウレシル フィードバック】{category}"
    body = "\n".join([
        "アプリ内からフィードバックが届きました。",
        "",
        f"種別　　　: {category}",
        f"画面　　　: {v('page')}",
        f"利用者　　: {v('user_email')}",
        "",
        "内容:",
        v("message"),
        "",
        "-" * 40,
        f"ID　　　　: {getattr(feedback, 'id', None)}",
        f"ユーザーID: {getattr(feedback, 'user_id', None)}",
        f"ブラウザ　: {v('user_agent')}",
        f"受信日時　: {_fmt_jst(getattr(feedback, 'created_at', None))}",
    ])

    try:
        _send(subject, body)
        logger.info(
            "フィードバック通知メールを送信しました: id=%s to=%s",
            getattr(feedback, "id", None), _env("NOTIFY_EMAIL"),
        )
    except Exception as e:
        logger.error("フィードバック通知メールの送信に失敗しました: %s", e, exc_info=True)
