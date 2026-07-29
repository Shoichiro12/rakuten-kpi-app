# -*- coding: utf-8 -*-
"""メール通知（SMTP）。

現在の用途はコンサル問い合わせの受信通知のみ。問い合わせの一次チャネルが
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
from email.mime.text import MIMEText
from email.utils import formataddr

logger = logging.getLogger("notifications")


def _env(key: str) -> str:
    return (os.environ.get(key) or "").strip()


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
        f"受信日時　　: {getattr(inquiry, 'created_at', None)}",
    ])

    try:
        _send(subject, body)
        logger.info("問い合わせ通知メールを送信しました: id=%s", getattr(inquiry, "id", None))
    except Exception as e:
        # ここで落とすとフォーム送信がユーザー側でエラーになるため、ログのみ。
        logger.error("問い合わせ通知メールの送信に失敗しました: %s", e, exc_info=True)


_FEEDBACK_CATEGORY_LABELS = {
    "bug": "不具合の報告",
    "request": "改善の要望",
    "other": "その他",
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
        f"受信日時　: {getattr(feedback, 'created_at', None)}",
    ])

    try:
        _send(subject, body)
        logger.info("フィードバック通知メールを送信しました: id=%s", getattr(feedback, "id", None))
    except Exception as e:
        logger.error("フィードバック通知メールの送信に失敗しました: %s", e, exc_info=True)
