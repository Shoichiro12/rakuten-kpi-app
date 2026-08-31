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

import mail_templates

logger = logging.getLogger("notifications")

# 招待メールの差出人表示（計画書 docs/jisso_keikaku_comp_invite_2026-08-31.md Q1で確定）。
# Gmail側で「名前を指定して送信」に登録済みであることが前提（_send のdocstring参照）。
_INVITE_FROM_ADDR = "info@ureshiru.com"
_INVITE_EXPIRES_LABEL_DEFAULT = "1時間"

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


def _send(subject: str, body: str, *, to: str = None, from_name: str = "ウレシル",
          from_addr: str = None) -> None:
    """プレーンテキストメールを送る。例外は呼び出し元へ伝播する。

    to/from_name/from_addr を省略すると従来どおり NOTIFY_EMAIL 宛・SMTP_USER 名義
    （表示名のみ「ウレシル」）で送る（問い合わせ・フィードバック通知はこの既定のまま）。
    招待メール（send_invite）は to=対象メール・from_addr=info@ureshiru.com を指定する。

    ⚠️ SMTP認証自体は常に SMTP_USER（Gmailの実アカウント）で行う（sendmail() の
    エンベロープ送信者も user のまま）。from_addr はヘッダー上の表示 From のみを変える。
    Gmail側で「名前を指定して送信」に登録済みのアドレスでないと、Gmailが実際の
    差出人表示を SMTP_USER に書き換える（CLAUDE.md 申し送り参照）。
    """
    host = _env("SMTP_HOST")
    port = int(_env("SMTP_PORT") or 587)
    user = _env("SMTP_USER")
    password = _env("SMTP_PASSWORD")
    to = to or _env("NOTIFY_EMAIL")
    from_addr = from_addr or user

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = formataddr((from_name, from_addr))
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


def send_invite(*, email: str, action_link: str, message: str = "",
                 expires_label: str = None) -> None:
    """管理画面からの無償アカウント招待メールを送る（計画書§3-2・§4）。

    ⚠️ 問い合わせ・フィードバック通知（send_inquiry_notification / send_feedback_notification）
    と違い、例外を握りつぶさず呼び出し元へ伝播する。呼び出し元（routers/admin_comp.py）は
    アカウント作成・comp付与は既に完了した状態でこの送信だけ失敗し得るため、
    invite_status を "failed" にして 502 を返し、再送ボタンで送り直せるようにする
    必要があるため（計画書§3-2 手順8）。
    """
    if not smtp_configured():
        raise RuntimeError(
            "SMTPが未設定のため招待メールを送信できません"
            "（SMTP_HOST/SMTP_USER/SMTP_PASSWORD/NOTIFY_EMAIL）。"
        )
    subject = mail_templates.INVITE_SUBJECT
    body = mail_templates.invite_body(
        email=email,
        action_link=action_link,
        message=message,
        expires_label=expires_label or _INVITE_EXPIRES_LABEL_DEFAULT,
    )
    # action_link 自体はログに出さない（開けばログインできるリンクのため）。
    _send(subject, body, to=email, from_name="ウレシル", from_addr=_INVITE_FROM_ADDR)
    logger.info("招待メールを送信しました: to=%s", email)
