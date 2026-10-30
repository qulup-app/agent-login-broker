# Agent Login Broker

**AI エージェントが、あなたの [Bitwarden](https://bitwarden.com) の認証情報でログインします。ブローカーは認証情報をエージェントに渡しません。Bitwarden が必要です。**

[English](README.md) | 日本語

AI エージェントの代わりに、あなたの ID とパスワードでウェブサイトにログインする
[MCP](https://modelcontextprotocol.io) サーバー（エージェントに新しいツールを足す仕組み）です。
エージェントはパスワードを一度も見ません。このサーバーは認証情報を
[Agent Access](https://github.com/bitwarden/agent-access)（`aac`）経由で Bitwarden から取り出し、
このプロセスの中で使って捨てます。取り出すのは、あなたが承認したとき（またはあなたが許可した
自動承認の範囲内）だけです。ツールが返すのは結果だけで、パスワードも、ワンタイムコードも、
ログイン状態も返しません。

サイトごとに**レシピ**が必要です。レシピはログインページの場所と、アカウントとパスワードを入れる
欄を書いた数行の設定です。案はエージェントが作り、保存する前にあなたに見せます。

> **状態: 初期版（0.1.1）。** パスワードを扱うツールです。使う前に
> [守れること・守れないこと](#守れること守れないこと)を読んでください。
> 動作を確認したのは macOS だけで、Linux と Windows は未確認です。

## 必要なもの

- [Node.js](https://nodejs.org) 20 以上
- ログイン済みの [Bitwarden CLI](https://bitwarden.com/help/cli/)（`bw`）
- [bitwarden/agent-access](https://github.com/bitwarden/agent-access) の `aac`。このマシンとペアにしておく
  （下記）。**`login` には必須**で、無いとどのサイトにもログインできません
  （`propose_recipe` は認証情報を使わないので、無くても動きます）。
  `$AGENT_LOGIN_BROKER_AAC`、`~/.local/bin/aac`、`PATH` 上の `aac` の順に探します。
  `aac` 0.11.0 で確認しています。`aac` はまだ 1.0 前なので、今後の版でブローカーが頼っている
  動きが変わる可能性があります。
- このパッケージが固定している [Playwright](https://playwright.dev) のバージョンに合った [Chromium](https://playwright.dev/docs/browsers)（[はじめかた](#はじめかた)を参照）
- 任意: [herdr](https://herdr.dev)（AI エージェント向けにターミナルの作業場所を管理するツール）と、
  herdr のペインで動くブラウザ [terminal-browser](https://github.com/zenbu-labs/terminal-browser)。承認待ちの `aac listen` を前面に出し、ログイン後の
  ページをエージェントの隣に表示します（[herdr との連携](#herdr-との連携)）。

## はじめかた

1. 使っているエージェントにプラグインを入れる（[導入](#導入)）。入れたらエージェントを起動し
   直し、ツールの一覧（Claude Code なら `/mcp`）に `agent-login-broker` が出ることを確かめる。
2. このリリースに合った Chromium を入れる。下のコマンドは 0.1.1 用です。別のリリースでは、
   プラグインのバージョン（エージェントのプラグイン一覧に出ます）に置き換えてください。

   ```bash
   npx -y -p agent-login-broker@0.1.1 playwright install chromium
   ```

   バージョンを付けない `npx playwright install chromium` は最新の Playwright 用のブラウザを入れるので、
   ここで固定しているバージョンと合わないことがあります。
3. `aac` をこのマシンと 1 回だけペアにする（[ペアと承認](#ペアと承認)）。
4. Bitwarden にサイトのログイン情報があり、その URI がサイトのアドレスになっていることを確かめて
   （`aac` はそのホスト名で項目を探します）、`bw sync` する。認証アプリを使う二段階認証のサイト
   なら、その鍵も項目に保存する（[二段階認証](#二段階認証ワンタイムコード)）。
5. `aac listen` を起動して `/unlock` してから、エージェントに「app.example.com にログインして」と
   頼む。初回はレシピの案を見せてくるので、読んでから
   `~/.config/agent-login-broker/recipes.json` に保存させる。続いて `aac listen` で承認する。
   エージェントが `logged in to app.example.com` と報告すれば成功です。画面を見たければ、
   開くよう頼んでください。

5 の `aac listen` を毎回思い出さずに済ませるには、[おすすめの構成](#おすすめの構成)を見てください。
ターミナルではなく Claude や Codex のデスクトップアプリを使う場合は、[デスクトップアプリ](#デスクトップアプリ)
を見てください。

準備そのものをエージェントに任せることもできます。エージェントに「
https://github.com/qulup-app/agent-login-broker/blob/main/AGENT_SETUP.md を読んで
agent-login-broker を使えるようにして」と頼んでください。エージェントにできる手順は進め、
あなたにしかできない手順（`aac listen` の解錠、ペア作り、承認）は伝えてきます。

## 導入

プラグインには MCP サーバー（`npx -y agent-login-broker@<バージョン>` で起動）と、
ログインとレシピ作りの手順をエージェントに教える skill が入っています。

| エージェント | 導入 | 更新 |
|---|---|---|
| [Claude Code](https://code.claude.com/docs) | `claude plugin marketplace add qulup-app/agent-login-broker` の後に `claude plugin install agent-login-broker@agent-login-broker` | `claude plugin update agent-login-broker@agent-login-broker` |
| [Codex](https://developers.openai.com/codex) | `codex plugin marketplace add qulup-app/agent-login-broker` の後に `codex plugin add agent-login-broker@agent-login-broker` | `codex plugin marketplace upgrade` |
| [omp](https://omp.sh) | `omp plugin marketplace add qulup-app/agent-login-broker` の後に `omp plugin install agent-login-broker@agent-login-broker` | `omp plugin marketplace update` の後に `omp plugin upgrade` |
| [pi](https://github.com/badlogic/pi-mono) | `pi install git:github.com/qulup-app/agent-login-broker` | `pi update --extensions` |
| その他の MCP クライアント | stdio サーバー: コマンド `npx`、引数 `["-y", "agent-login-broker@<バージョン>"]` | バージョンを書き換える |

プラグインの各リリースは対応する [npm](https://www.npmjs.com/package/agent-login-broker) のバージョンに固定され、npm パッケージには
`npm-shrinkwrap.json` が入っているので、依存パッケージも固定されます。エージェント自身の
更新コマンドで入れていないコードが動くことはありません。pi は npx を使わず、導入した
パッケージからサーバーを起動します。

## ペアと承認

`aac` は Agent Access の CLI です。[リリースページ](https://github.com/bitwarden/agent-access/releases)
から入手し、`PATH` の通った場所か `~/.local/bin` に置いてください。Bitwarden CLI を通して保管庫を
読むので、先に Bitwarden CLI にログインしておいてください（`bw login`、1 回だけ）。

続いて、1 回だけペアを作ります。

1. `aac listen` を起動し、`/unlock` と入力して保管庫を解錠する。
2. `/pair agent-login-broker` と入力する。ペア用のコードが表示されます。
3. 別の端末で次の行を実行し、そのコードを入力する。

   ```bash
   read -rs AAC_TOKEN && export AAC_TOKEN && aac connect; unset AAC_TOKEN
   ```

   （`read -rs` なので、コードは画面にもシェルの履歴にも残りません。`aac` は `AAC_TOKEN` 変数から
   読むので、`ps` で見えるコマンドラインにも出ません。ただし `aac connect` が動いている間は、
   あなたと同じユーザーで動くプロセスからこの変数を読めます。）

ペアは保存されるので、次からは `aac listen` を起動して解錠しておくだけで済みます。ペアはこの
マシンに 1 つだけにしてください。複数あると（`aac connections list` で見られます）、`aac` は
ブローカーがどれを使うのか決められず、ログインに失敗します。

ログインのたびに、`aac listen` での承認を最大 3 分待ちます。3 分以内に承認が無ければ、時間切れで
失敗します。`aac listen` はエージェントにログインを頼むときだけ動いていれば足ります。
運用は次から選んでください。

| 方法 | 手間 | 向いている人 |
|---|---|---|
| ログインを頼む直前に、別のタブで `aac listen` を起動して `/unlock` する | 毎回 1 手 | たまに使う |
| `aac listen` を開いたタブを 1 つ置いておく | 起動時に 1 回 | よく使う |
| [tmux](https://github.com/tmux/tmux) や [screen](https://www.gnu.org/software/screen/) の中で動かす | 最初に 1 回 | SSH 先や複数の端末から承認したい |

herdr が無い場合、承認待ちになるとデスクトップに通知が出ます（macOS は通知センター、Linux は
[`notify-send`](https://gitlab.gnome.org/GNOME/libnotify) が入っていれば）。herdr があると、さらに `aac listen` を前面に出します
（[herdr との連携](#herdr-との連携)）。

`login` が `aac connect failed (exit N…)` で失敗したときの、よくある終了コードと確かめることは次の
とおりです（ほかの終了コードは `aac --help` に載っています）。

| 終了コード | `aac` の意味 | 確かめること |
|---|---|---|
| 2 | 接続に失敗 | `aac listen` が動いていて解錠済みか。このマシンがペアになっているか |
| 3 | 認証に失敗 | 要求を拒否していないか。続くならペアを作り直す |
| 4 | 見つからない | URI がサイトのホスト名になっている項目が保管庫にあるか。変更後は `bw sync` する |

## 設定

| 変数 | 意味 |
|---|---|
| `AGENT_LOGIN_BROKER_RECIPES` | レシピファイル（既定は `~/.config/agent-login-broker/recipes.json`）。ここにあるサイトはすべてログインの対象 |
| `AGENT_LOGIN_BROKER_SITES` | 任意。カンマ区切りのホスト名。設定すると、ログインとレシピ作りをこのホストだけに限る。空文字にするとどのサイトも許可しない |
| `AGENT_LOGIN_BROKER_AAC` | `aac` のパス |
| `AGENT_LOGIN_BROKER_HERDR` | `herdr` のパス（既定は `herdr`） |
| `AGENT_LOGIN_BROKER_TERMINAL_BROWSER` | `terminal-browser` のパス（既定は `terminal-browser`） |
| `AGENT_LOGIN_BROKER_NOTIFY` | `off` にすると、承認待ちのデスクトップ通知を出さない |
| `AGENT_LOGIN_BROKER_TOKEN_FILE` | HTTP モードの呼び出し元トークン（既定は `~/.config/agent-login-broker/token`） |

サイトの Bitwarden 項目はホスト名と一致している必要があります（`aac connect --domain <site>`）。
`aac` は Bitwarden CLI の手元の写しを読むので、アプリで項目を変えたら `bw sync` してください。

## ログインの仕組み

このプロセスが持つ画面なしの Chromium が、レシピのログインページを開いてフォームに入力します。
ワンタイムコードの欄が出たら、項目の認証キー（TOTP）からコードを作って入れます。ワンタイムコードの
欄とみなすのは、レシピの `otp` セレクタの欄、それが無ければ `autocomplete="one-time-code"` の欄だけで、
名前からは推測しません。成功とみなすのはレシピの `successPath` の下に着いたときだけで、それ以外は
失敗にします。**パスワードはページに入力するので、そのページで動くスクリプト（サイト自身や外部の
解析ツール）はそれを読めます**。手でログインするときと同じ条件です。このサーバーは Chromium を
パイプで操作し、CDP のポートを開かないので、エージェントからはこの Chromium に触れられません。

### 二段階認証（ワンタイムコード）

多くのサイトはパスワードの後にもう 1 段階の確認を求めます（二段階認証、2FA）。このツールが
答えられるのはそのうち 1 種類、認証アプリに出る 6 桁のコード（TOTP と呼ばれるもの）だけです。
ブローカーがこのコードを入力できるのは、項目にそのサイトの**認証キー**が
入っているときだけです。認証キーとは二段階認証を有効にするときに読み取る QR コードの元になる
秘密の文字列です。項目の「認証キー（Authenticator key）」欄に保存してください
（Bitwarden の[説明](https://bitwarden.com/help/integrated-authenticator/)）。コードはブローカーが
鍵から自分で計算します。

Bitwarden では、鍵の保存は無料です。Bitwarden 自身のアプリでコードを表示するには、Premium か
有料の組織プランが要ります。無料アカウントで `aac` が鍵を渡すかどうかは試していません。鍵を
保存したのに `login` が「認証キーが無い」と返す場合は、このプランの制限が原因の可能性があります。

SMS やメールで届くコード、アプリでの承認（プッシュ通知）、パスキーには答えられません。先に
パスキーを求めるサイトでも、認証アプリのコードを選べるなら、レシピの `otpSwitch` で使えます。

### CAPTCHA と bot 判定

CAPTCHA や Cloudflare のチャレンジ（[reCAPTCHA](https://developers.google.com/recaptcha)、[hCaptcha](https://www.hcaptcha.com)、[Turnstile](https://developers.cloudflare.com/turnstile/)、[Arkose](https://www.arkoselabs.com)）は、レシピでは
通れません。ブローカーがこれを見つけたときの動きは、次のとおりです。

- 止まります。ログインフォームの時点で出ていれば、認証情報を要求する前に止まります。
- `open_page` と同じ場所（terminal-browser、無ければ Chromium の窓）にログインページを開き、
  あなたが自分でログインできるようにして、エージェントにもそう伝えます。

`propose_recipe` は案を作る前に、`login` はフォームが出たときとログインに失敗したときに確かめます。

### レシピ

ログインできるのは、レシピのあるサイトだけです。

```json
{
  "app.example.com": {
    "loginPath": "/login",
    "username": "input[name=\"email\"]",
    "password": "input[name=\"password\"]",
    "successPath": "/dashboard",
    "otp": "input[name=\"code\"]"
  }
}
```

| 項目 | 必須 | 意味 |
|---|---|---|
| `loginPath` | はい | ログインページのパス（クエリ文字列も可） |
| `username`, `password` | はい | アカウント欄とパスワード欄の CSS セレクタ |
| `successPath` | はい | ログイン後に必ず着くパス。通常は `/` より下。`"/"` にするのは、`/` に着くサイト（GitHub など）で `successSelector` と組み合わせるときだけ |
| `successSelector` | `successPath: "/"` のとき | ログイン後のページにだけ出る要素（GitHub なら `"header [data-login]"`）。ログインも `open_page` も、この要素が見えている間だけログイン済みとみなす。このとき `open_page` はサイトのどのページでも開ける |
| `otp` | いいえ | ワンタイムコードの欄のセレクタ |
| `otpSwitch` | いいえ | 先にパスキーを求めるアカウント向け。認証アプリのコード入力へ切り替えるリンクやボタン（GitHub なら `a[href="/sessions/two-factor/app"]`）。コードの欄が無いときに押す |
| `itemId` | いいえ | 1 つのサイトに Bitwarden の項目が複数あるとき（同じサービスの 2 アカウントなど）、使う項目の id。下を参照 |

`itemId` があると、`--domain` の代わりに `aac connect --id` でその項目を取り出します。項目自身の
URI はレシピのサイトにある必要があり、違えば何も入力する前に失敗します。「サイトにある」とは
同じ登録ドメインであることです（Bitwarden のベースドメイン一致と同じ。`www.example.com` で保存した
項目は `accounts.example.com` に使えます）。

`successPath` や `otpSwitch` を調べるには、一度ログインさせてください。失敗すると、着いたページ、
そのページの入力欄の名前と種類（値は出さない）、その近くのリンクがエラーに出ます。
レシピファイルは起動時と `login` のたびに読み直します（起動時に壊れていれば、サーバーは起動しません）。
そのため、新しいレシピを足しても再起動は要りません。

レシピは手で書かなくても構いません。エージェントにログインを頼むと、`login` がレシピ無しと
返したとき、エージェントが `propose_recipe` を呼びます。`propose_recipe` は認証情報を使わずに
ログインページを開いて案を作ります。**保存する前に必ず案を読んでください**。
レシピは「パスワードをどの欄に入れるか」を決めるもので、悪意のあるページに誘導されたエージェントが、
入力内容を公開してしまう欄を選ぶおそれがあります。`propose_recipe` が案を作れるのはパスワード欄が
見えるページだけですが、`login` は同じホストの 2 ページ目でパスワードを聞くサイトにも対応しています。
別のホストにあるフォームは非対応として報告します。

Google（`google.*` のサイト）へのログインは最初から断ります。アカウントを入力した直後に、Google が
自動操作のブラウザへ「このブラウザは安全でない可能性があります」というページを返すためです。誰が
ボタンを押しても変わりません。ツールはそう伝え、Google の API か普段のブラウザを案内します。

## ツール

| ツール | 動作 | 返すもの |
|---|---|---|
| `login(site)` | `aac connect --domain <site>`（レシピに `itemId` があれば `--id <itemId>`）で認証情報を取り出し、上のとおりにログインする | `logged in to <site>`、またはエラー |
| `open_page(site, path?)` | ログイン後のサイトをあなたに見せる。`successPath` の下のページだけ | 開いた URL |
| `propose_recipe(site, path?)` | 認証情報を使わずにログインページを開き、レシピの案を作る。何も保存しない | 案と、仕上げる手順 |

`open_page` は次のように動きます。

- このマシンで Chromium の窓を開きます。terminal-browser があり、エージェントが herdr の中で動いていれば、エージェントの隣のペインを使います（[herdr との連携](#herdr-との連携)）。
- 渡すのはそのホストのログイン状態だけです。具体的には、そのホストに送られる Cookie（そのホスト
  自身と親ドメインのもの）と、そのホストの localStorage です。
- ページが開き終わるまで、画面そのものは別のホストへ移れません。別のホストへの移動や転送は、
  送る前に止めます。ページが読み込む画像、スクリプト、フレームは止めません。

ブローカーのログイン状態はこのプロセスのメモリにだけあるので、エージェント（とそれが起動した
サーバー）を起動し直すと、ログインし直しになります。

## デスクトップアプリ

Claude や Codex のデスクトップアプリも、ほかの MCP クライアントと同じようにサーバーを起動します。
ターミナルで使う場合と違うのは 2 点です。

- `aac listen` にはやはりターミナルが要ります。対話型の画面で、起動のたびに `/unlock` を求める
  ためです。ターミナルの窓を 1 つ開いて動かしておいてください。Mac の起動と一緒に立ち上げるなら、
  起動時に `aac listen` を実行する「ターミナル」のプロファイルを作り、その窓をログイン項目で開く
  方法があります（ここでは未検証で、名前は macOS のバージョンで違うことがあります）。承認待ちは
  デスクトップ通知で知らせるので、窓は裏にあって構いません。
- デスクトップアプリはシェルの `PATH` を読まないことがあります。サーバーが起動しない場合は、
  コマンドに `npx` の絶対パス（`which npx` で分かります）を指定してください。

[導入](#導入)のコマンドはコマンドラインのツール向けです。デスクトップアプリの中からの導入は、
まだ試していません。

## おすすめの構成

いちばん見落としやすいのは承認です。`aac listen` を自動で起動し、ログインのときに前面へ出す
構成がいちばん使いやすくなります。

1. エージェントを [herdr](https://herdr.dev) の中で動かし、`open_page` 用に
   [terminal-browser](#herdr-との連携) を入れる。
2. エージェントを起動するたびに、herdr の `aac-listen` という workspace で `aac listen` を
   起動しておく。解錠は 1 回で済み、エージェントを終えても残ります。

2 はエージェントのコマンドを包むシェル関数で足ります（zsh か bash、[`jq`](https://jqlang.org) が必要）。

```bash
# herdr の workspace「aac-listen」で aac listen が動いているようにする: workspace が無ければ作り、
# workspace はあるのに aac listen が止まっていれば起動し直す
aac_listen_ensure() {
  local ws pane
  ws=$(herdr workspace list | jq -r '.result.workspaces[] | select(.label == "aac-listen") | .workspace_id' | head -n 1)
  if [ -n "$ws" ]; then
    pane=$(herdr pane list --workspace "$ws" | jq -r '[.result.panes[] | select(.label == null)][0].pane_id // empty')
    herdr pane process-info --pane "$pane" |
      jq -e '.result.process_info.foreground_processes[]? | select(.name == "aac" and .argv[1] == "listen")' >/dev/null && return
  else
    pane=$(herdr workspace create --label aac-listen --no-focus | jq -r '.result.root_pane.pane_id // empty')
  fi
  [ -n "$pane" ] && herdr pane run "$pane" "aac listen"
}
claude() { aac_listen_ensure; command claude "$@"; }   # codex、omp、pi も同じ形で
```

こうしておくと、ログインのたびにブローカーが herdr を `aac-listen` に切り替えて通知を出し、
答えると元に戻します。`open_page` は、ログイン後のサイトをエージェントの隣のペインに開きます
（Codex のプラグインでは Chromium の窓。[herdr との連携](#herdr-との連携)を参照）。

## herdr との連携

[herdr](https://herdr.dev) と terminal-browser が入っている場合は、次のようになります。

- `aac listen` を herdr の `aac-listen` という名前の workspace で動かしてください。認証情報の
  要求のたびに、その workspace に画面を移して通知を出し、承認が済んだら元の場所に戻します
  （その間に自分で移動していれば戻しません）。herdr が無い場合は、代わりにデスクトップ通知が
  出ます（[ペアと承認](#ペアと承認)を参照）。
- `open_page` は、エージェントの herdr ペインの隣に terminal-browser のペインを分割します。その後、
  terminal-browser を使う `open_page` は、どのエージェントや HTTP モードからでも、あなたが閉じるまで
  その 1 つの窓をその場所のまま使い回します。**エージェントは `terminal-browser action` でこのページを操作できます**。
  Chromium の窓ではできません。ブローカーがエージェントのペインを知らないときは、代わりに
  Chromium の窓を開きます。herdr の外で動くエージェントと、Codex のプラグイン（Codex はプラグインの
  MCP サーバーにエージェントの herdr ペインを渡しません）がこれに当たります。
  [HTTP モード](#http-モード)にもエージェントのペインはありませんが、こちらは `aac-listen` の隣に
  開きます。`AGENT_LOGIN_BROKER_TERMINAL_BROWSER` を存在しないパスにすると、常に Chromium の窓に
  なります。どちらの場合も、承認待ちには `aac-listen` へ切り替わります。

## HTTP モード

HTTP モードは上級者向けで、通常の構成では要りません。`agent-login-broker --http <port>` は Streamable HTTP を
`127.0.0.1` だけで待ち受けます。サーバーを自分で起動できないクライアント（コンテナの中の
エージェントなど）向けです。

- 呼び出し元は `~/.config/agent-login-broker/token`（初回起動時に 0600 で作る）のトークンを
  `X-Agent-Login-Broker-Token` ヘッダーで送る必要があります。このトークンはほかのローカルの
  プロセスやコンテナにツールを使わせないためのもので、ツールを使うエージェントには読めます。
- 受け付ける `Host` ヘッダーは `127.0.0.1`、`localhost`、`host.docker.internal` です。
  コンテナからは、`host.docker.internal` がホストの loopback に届く環境で使えます（[OrbStack](https://orbstack.dev) で
  確認）。Linux の [Docker](https://www.docker.com) では `host.docker.internal` がブリッジのゲートウェイを指すので、
  loopback だけで待ち受けるサーバーには届かないはずです（未確認）。
- サーバーは環境変数を読み直さないので、`AGENT_LOGIN_BROKER_SITES` を変えたら再起動してください
  （レシピはログインのたびに読み直します）。

## 守れること・守れないこと

- 守れる: パスワードとワンタイムコードは、エージェントの会話、ツールの出力、ログに出しません。
  ログインに失敗したときのエラーにそれらが入っていたら（入力したままの形か URL エンコードした形。
  たとえばページがパスワードを URL に書き写した場合）、代わりに決まった文のエラーを返します。
  ページがほかの形に変えて書き写したものは見つけられません。
  認証情報の取り出しは必ず `aac listen` を通り、あなたの承認を待ちます。ただし、そこで許可した
  自動承認の範囲内なら聞かれずに通ります（下記）。ログイン先は `https://<site>` だけです。
  ログイン状態はあなたが `open_page` するまでこのプロセスの中にとどまります。
- 守れない: エージェントはあなたと同じユーザーで動くので、`~/.access-protocol/` のペア情報を
  使って `aac connect` を自分で実行できます。そのときの承認画面はブローカーのものと見分けが
  つかないので、**自分で頼んだ直後以外の承認要求はすべて拒否してください。** `aac listen` の
  自動承認（`[a]`、N 分間）は短くしてください。その間は、同じサイトへの要求が聞かれずに通ります。
- レシピファイルはエージェントが書き換えられるので、サイトを足したり、パスワードを入れる欄を
  変えたりできます。次のログインを承認する前にレシピの変更を読み、エージェントがファイル経由で
  増やせない固定の一覧が欲しければ `AGENT_LOGIN_BROKER_SITES` を設定してください。
- `AGENT_LOGIN_BROKER_SITES` が無いと、エージェントは `propose_recipe` で、公開されている任意の
  HTTPS のログインページをブローカーのブラウザで開けます（認証情報は使いません）。内部向けの名前と
  プライベートアドレスは断り、別のホストへの転送も止めますが、公開ドメインの名前が内部の
  アドレスを指している場合は見分けられません。また、ホストにとどめるのは画面そのものだけで、
  ページが読み込む画像、スクリプト、フレームは内部のアドレスを含むどこへでも届きます。
- ログイン後は、ツールが許す範囲のことをエージェントができます。terminal-browser に渡した
  ログイン状態はエージェントも使えるので、そのページでできること（証券会社なら注文も）は
  エージェントにもできます。危険な操作ができるサイトでは `open_page` を使わないでください。
- `open_page` が terminal-browser を使う構成では、bot 判定の後に開くログインページもそこに開くので、
  そこに入力したもの（パスワードを含む）はエージェントが読めます。エージェントにはそのページに
  触れないよう伝えていますが、それで足りないサイトでは、普段のブラウザでログインしてください。
  Chromium の窓なら、エージェントはそのページに触れられません。
- パスワードはサイトのページに入力するので、そのサイトの中にとどまるとは限りません。ページ自身の
  スクリプトと、ページが読み込む外部のスクリプト（解析、広告、CDN）はそれを読めて、どこへでも
  送れます（[ログインの仕組み](#ログインの仕組み)）。上の「ログイン先は `https://<site>` だけ」は、
  ブローカーが開いて入力するのがそのホストのページだけ、という意味です。
- 通信: `server.mjs` は自分からはマシンの外へ接続せず（HTTP モードのローカルサーバーのほかは、
  terminal-browser のブラウザへ loopback で接続するだけ）、利用状況の送信もしません。
  マシンの外へ出る通信は、ブローカーの Chromium が
  サイトとそのページが読み込むものを取りに行く通信と、`aac` が Bitwarden の中継サーバー（既定は
  `wss://ap.lesspassword.dev`）を通して認証情報を取り出す通信です。中継サーバーでの扱いは
  Bitwarden の説明に従います。

## 利用規約と商標

自動操作のブラウザでのログインは、サイトの利用規約に反する場合があります。禁止しているサイトも
あり、Google は実際に拒否しています。サイトの規約を確認し、その範囲で使う責任は利用者にあります。
使うのは、自分のアカウントか、使う許可を得ているアカウントだけにしてください。他人のアカウントへの
ログインは違法になる場合があります。

このプロジェクトは Bitwarden、GitHub、Google、Cloudflare、そのほかここに名前を挙げた企業とは
提携しておらず、推奨も受けていません。名前は対応状況を説明するためだけに使っています。

## セキュリティ上の問題の報告

脆弱性は公開の Issue に書かないでください。修正してから公開できるよう、
[GitHub の脆弱性報告](https://github.com/qulup-app/agent-login-broker/security/advisories/new)
から非公開で報告してください。

## 開発

```bash
npm ci
npm test
```

`flake.nix` が Node を提供します（`nix build .#default --out-link .nix/node` で作り、out-link が GC ルートになります）。

## ライセンス

MIT。[LICENSE](LICENSE) を参照してください。このソフトウェアは無保証です。利用は自己責任で
お願いします。認証情報の漏えい、アカウントの停止、ログインしたサイトでの意図しない操作が
起こりえます。[LICENSE](LICENSE) にあるとおり、利用によって生じた損害について作者は責任を
負いません。依存パッケージは npm がそれぞれのライセンス（いずれも寛容なライセンス: MIT、ISC、
Apache-2.0、BSD）で入れます。このパッケージには同梱していません。
