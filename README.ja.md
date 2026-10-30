# Agent Login Broker

**AI エージェントが、あなたの [Bitwarden](https://bitwarden.com) の認証情報でウェブサイトにログインします。ブローカーは、認証情報をエージェントに渡さないように作られています。Bitwarden が必要です。**

<img src="docs/demo-ja.gif" width="480" alt="AI がパスワードを尋ねる。Bitwarden で承認するとブローカーがログインし、AI には「logged in to example.com」だけが返る">

[English](README.md) | 日本語

エージェントの代わりにログインして、結果だけを返す [MCP](https://modelcontextprotocol.io) サーバー（エージェントに新しいツールを足す仕組み）です。パスワードとワンタイムコードは、あなたが承認したとき（または、あなたが許可した自動承認の範囲内）だけ [Agent Access](https://github.com/bitwarden/agent-access)（`aac`）経由で取り出し、このプロセスの中で使って捨てます。ツールはパスワードもワンタイムコードもログイン状態も返しません。

> **状態: 初期版（0.1.2）。macOS でのみ確認、Linux と Windows は未確認です。**
> パスワードを扱うツールです。使う前に[セキュリティと制限事項](#セキュリティと制限事項)を読んでください。

## 必要なもの

- [Node.js](https://nodejs.org) 20 以上
- ログイン済みの [Bitwarden CLI](https://bitwarden.com/help/cli/)（`bw`）
- [Agent Access](https://github.com/bitwarden/agent-access) の `aac`。[リリースページ](https://github.com/bitwarden/agent-access/releases)から入手し、`PATH` の通った場所か `~/.local/bin` に置きます。`login` に必須です（`propose_recipe` は無くても動きます）。0.11.0 で確認しています。まだ 1.0 前なので、今後の版で動かなくなる可能性があります。
- このパッケージが固定している [Playwright](https://playwright.dev) の版に合った [Chromium](https://playwright.dev/docs/browsers)（[はじめかた](#はじめかた)を参照）
- 任意: [herdr](https://herdr.dev)（AI エージェント向けのターミナルの作業場所の管理ツール）と、そのペインで動くブラウザ [terminal-browser](https://github.com/zenbu-labs/terminal-browser)。承認待ちの `aac listen` を前面に出し、ログイン後のページをエージェントの隣に表示します（[herdr と terminal-browser](#herdr-と-terminal-browser)）。

## 導入

プラグインには、MCP サーバー（`npx -y agent-login-broker@<版>` で起動）と、ログインとレシピ作りの手順をエージェントに教える skill が入っています。

| エージェント | 導入 | 更新 |
|---|---|---|
| [Claude Code](https://code.claude.com/docs) | `claude plugin marketplace add qulup-app/agent-login-broker` の後に `claude plugin install agent-login-broker@agent-login-broker` | `claude plugin update agent-login-broker@agent-login-broker` |
| [Codex](https://developers.openai.com/codex) | `codex plugin marketplace add qulup-app/agent-login-broker` の後に `codex plugin add agent-login-broker@agent-login-broker` | `codex plugin marketplace upgrade` |
| [omp](https://omp.sh) | `omp plugin marketplace add qulup-app/agent-login-broker` の後に `omp plugin install agent-login-broker@agent-login-broker` | `omp plugin marketplace update` の後に `omp plugin upgrade` |
| [pi](https://github.com/badlogic/pi-mono) | `pi install git:github.com/qulup-app/agent-login-broker` | `pi update --extensions` |
| その他の MCP クライアント | stdio サーバー: コマンド `npx`、引数 `["-y", "agent-login-broker@<版>"]` | 版を書き換える |

プラグインの各リリースは対応する [npm](https://www.npmjs.com/package/agent-login-broker) の版に固定され、npm パッケージには `npm-shrinkwrap.json` が入っているので、依存パッケージも固定されます。エージェントの更新コマンドで入れていないコードが動くことはありません。pi は npx を使わず、導入したパッケージからサーバーを起動します。

## はじめかた

> **準備をエージェントに任せることもできます。** 「https://github.com/qulup-app/agent-login-broker/blob/main/AGENT_SETUP.md を読んで agent-login-broker を使えるようにして」と頼むと、エージェントにできる手順を進め、あなたにしかできない手順（`aac listen` の解錠、ペア作り、承認）を案内します。

### 1. 最初に 1 回だけ行うこと

1. **プラグインを入れる**: [導入](#導入)のとおりに入れ、エージェントを起動し直します。ツールの一覧（Claude Code なら `/mcp`）に `agent-login-broker` が出れば入っています。
2. **Chromium を入れる**: 下のコマンドは 0.1.2 用です。別の版では、プラグインの版（エージェントのプラグイン一覧に出ます）に置き換えてください。版を付けない `npx playwright install chromium` は最新の Playwright 用を入れるので、合わないことがあります。

   ```bash
   npx -y -p agent-login-broker@0.1.2 playwright install chromium
   ```

3. **`aac` をペアにする**: `aac` は Bitwarden CLI を通して保管庫を読むので、先に `bw login` しておきます。
   1. `aac listen` を起動し、`/unlock` で保管庫を解錠して、`/pair agent-login-broker` と入力します。ペア用のコードが出ます。
   2. 別の端末で次の行を実行し、そのコードを入力します。

      ```bash
      read -rs AAC_TOKEN && export AAC_TOKEN && aac connect; unset AAC_TOKEN
      ```

      コードは画面にもシェルの履歴にも、`ps` で見えるコマンドラインにも出ません。ただし `aac connect` が動いている間は、あなたと同じユーザーで動くプロセスからこの変数を読めます。

   ペアは保存されます。ペアはこのマシンに 1 つだけにしてください。複数あると（`aac connections list` で見られます）、ブローカーがどれを使うか決められず、ログインに失敗します。
4. **Bitwarden を準備する**: ログインしたいサイトの項目の URI を、サイトのホスト名にしておきます（`aac` はホスト名で項目を探します）。項目を変えたら `bw sync` してください。認証アプリを使う二段階認証のサイトは、項目に認証キーも保存します（[二段階認証](#二段階認証)）。

### 2. ログインするたびに行うこと

1. `aac listen` を起動し、`/unlock` で解錠しておきます。毎回の手間を省くなら[おすすめの構成](#おすすめの構成)を見てください。
2. エージェントに「app.example.com にログインして」と頼みます。
3. 初めてのサイトでは、エージェントがログインページを調べて**レシピ**（ログインページの場所と、アカウントとパスワードを入れる欄を書いた設定）の案を見せます。読んでから `~/.config/agent-login-broker/recipes.json` に保存させてください。
4. `aac listen` で要求を承認します。待つのは最大 3 分で、承認が無ければ時間切れになります。承認待ちになると、herdr があれば `aac listen` が前面に出て、無ければデスクトップ通知が出ます（macOS は通知センター、Linux は [`notify-send`](https://gitlab.gnome.org/GNOME/libnotify) が入っていれば）。
5. エージェントが `logged in to app.example.com` と報告すれば成功です。画面を見たいときは、ページを開くよう頼んでください（`open_page`）。

`aac listen` を動かしておく方法は、使い方に合わせて選べます。たまに使うならログインの直前に別のタブで起動し、よく使うならタブを 1 つ開いたままにし、SSH 先や複数の端末から承認したいなら [tmux](https://github.com/tmux/tmux) や [screen](https://www.gnu.org/software/screen/) の中で動かします。

#### `aac connect failed (exit N…)` で失敗したとき

よくある終了コードです（ほかは `aac --help` に載っています）。

| 終了コード | `aac` の意味 | 確かめること |
|---|---|---|
| 2 | 接続に失敗 | `aac listen` が動いていて解錠済みか。このマシンがペアになっているか |
| 3 | 認証に失敗 | 要求を拒否していないか。続くならペアを作り直す |
| 4 | 見つからない | URI がサイトのホスト名になっている項目が保管庫にあるか。変更後は `bw sync` したか |

## 仕組みと対応範囲

### ツール

| ツール | 動作 | 返すもの |
|---|---|---|
| `login(site)` | `aac connect --domain <site>`（レシピに `itemId` があれば `--id <itemId>`）で認証情報を取り出し、画面なしの Chromium でログインする | `logged in to <site>`、またはエラー |
| `open_page(site, path?)` | ログイン後のサイトを、`successPath` の下のページだけあなたに見せる | 開いた URL |
| `propose_recipe(site, path?)` | 認証情報を使わずにログインページを開き、レシピの案を作る。何も保存しない | 案と、仕上げる手順 |

`login` は、このプロセスが持つ画面なしの Chromium でレシピのログインページを開き、フォームに入力します。成功とみなすのは、レシピの `successPath` の下に着いたときだけです。この Chromium はパイプで操作し、CDP のポートを開かないので、エージェントからは触れられません。

`open_page` は、このマシンに Chromium の窓を開きます。terminal-browser があり、エージェントが herdr の中で動いていれば、エージェントの隣のペインを使います（[herdr と terminal-browser](#herdr-と-terminal-browser)）。渡すのは、そのホストに送られる Cookie（そのホスト自身と親ドメインのもの）と、そのホストの localStorage だけです。ページが開き終わるまでは、画面そのものは別のホストへ移れません（別のホストへの移動や転送は送る前に止めます）。ページが読み込む画像、スクリプト、フレームは止めず、開き終わった後は画面の移動も止めません。ログイン状態はこのプロセスのメモリにだけあるので、エージェントを起動し直すとログインし直しになります。

### レシピ

ログインできるのは、レシピのあるサイトだけです。レシピはエージェントに案を作らせることも、手で書くこともできます。ファイルはログインのたびに読み直すので、足しても再起動は要りません（起動時に壊れていれば、サーバーは起動しません）。

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
| `successSelector` | `successPath: "/"` のとき | ログイン後のページにだけ出る要素（GitHub なら `"header [data-login]"`）。この要素が見えている間だけログイン済みとみなす |
| `otp` | いいえ | ワンタイムコードの欄のセレクタ。無ければ `autocomplete="one-time-code"` の欄だけを使い、名前からは推測しない |
| `otpSwitch` | いいえ | 先にパスキーを求めるサイトで、認証アプリのコード入力へ切り替えるリンクやボタン（GitHub なら `a[href="/sessions/two-factor/app"]`） |
| `itemId` | いいえ | 1 つのサイトに Bitwarden の項目が複数あるときに使う項目の id。項目の URI はレシピのサイトと同じ登録ドメインである必要があり、違えば何も入力する前に失敗する |

`successPath` や `otpSwitch` を調べるには、一度ログインさせてください。失敗すると、着いたページ、その入力欄の種類と名前（値は出さない）、近くのリンクがエラーに出ます。`propose_recipe` が案を作れるのはパスワード欄が見えるページだけですが、`login` は同じホストの 2 ページ目でパスワードを聞くサイトにも対応しています。別のホストにあるフォームは非対応です。

### 二段階認証

答えられるのは、認証アプリに出る 6 桁のコード（TOTP）だけです。項目の「認証キー（Authenticator key）」欄にそのサイトの鍵（二段階認証を有効にするときに読み取る QR コードの元の文字列）を保存しておくと、ブローカーが鍵からコードを計算します（Bitwarden の[説明](https://bitwarden.com/help/integrated-authenticator/)）。鍵の保存は無料ですが、無料アカウントで `aac` が鍵を渡すかどうかは試していません。鍵を保存したのに「認証キーが無い」と返る場合は、プランの制限が原因の可能性があります。

SMS やメールのコード、アプリでのプッシュ承認、パスキーには答えられません。先にパスキーを求めるサイトでも、認証アプリのコードを選べるなら `otpSwitch` で使えます。

### CAPTCHA と bot 判定

[reCAPTCHA](https://developers.google.com/recaptcha)、[hCaptcha](https://www.hcaptcha.com)、Cloudflare の [Turnstile](https://developers.cloudflare.com/turnstile/) やチャレンジ、[Arkose](https://www.arkoselabs.com) は、レシピでは通れません。見つけると止まり、`open_page` と同じ場所（terminal-browser、または Chromium の窓）にログインページを開いて、あなたが自分でログインできるようにします。ログインフォームの時点で出ていれば、認証情報を要求する前に止まります。

Google（`google.*` のサイト）へのログインは最初から断ります。自動操作のブラウザには、アカウントを入力した直後に「このブラウザは安全でない可能性があります」というページが返るためです。

## 応用

### herdr と terminal-browser

[herdr](https://herdr.dev) と terminal-browser が入っている場合は、次のように動きます。

- **承認**: `aac listen` を herdr の `aac-listen` という名前の workspace で動かしておくと、要求のたびにその workspace に画面を移して通知を出し、承認が済んだら元の場所に戻します（その間に自分で移動していれば戻しません）。
- **`open_page`**: エージェントの herdr ペインの隣に terminal-browser のペインを分割します。窓はエージェントのペインごとに 1 つで、あなたが閉じるまで使い回します。**エージェントは `terminal-browser action` でこのページを操作できます**（Chromium の窓ではできません）。
- **ペインが分からないとき**: herdr の外のエージェントと、Codex のプラグイン（Codex はプラグインの MCP サーバーに herdr のペインを渡しません）では、Chromium の窓を開きます。[HTTP モード](#http-モード)でペインのヘッダーが無いときは、`aac-listen` の隣に開きます。
- `AGENT_LOGIN_BROKER_TERMINAL_BROWSER` を存在しないパスにすると、常に Chromium の窓になります。

### おすすめの構成

いちばん見落としやすいのは承認です。エージェントを herdr の中で動かし、エージェントを起動するたびに `aac-listen` の workspace で `aac listen` を起動しておくと、解錠は 1 回で済み、ログインのたびに前面に出ます。エージェントのコマンドを包む次のシェル関数で足ります（zsh か bash、[`jq`](https://jqlang.org) が必要）。

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

### デスクトップアプリ

Claude や Codex のデスクトップアプリも、ほかの MCP クライアントと同じようにサーバーを起動します。違いは 2 点です。

- `aac listen` にはターミナルが要ります（起動のたびに `/unlock` を求める対話型の画面のため）。ターミナルの窓を 1 つ開いて動かしておいてください。承認待ちはデスクトップ通知で知らせるので、窓は裏にあって構いません。
- アプリがシェルの `PATH` を読まないことがあります。サーバーが起動しない場合は、コマンドに `npx` の絶対パス（`which npx` で分かります）を指定してください。

[導入](#導入)のコマンドはコマンドラインのツール向けで、デスクトップアプリの中からの導入は試していません。

### HTTP モード

上級者向けで、通常の構成では要りません。`agent-login-broker --http <port>` は、サーバーを自分で起動できないクライアント（コンテナの中のエージェントなど）向けに、Streamable HTTP を `127.0.0.1` だけで待ち受けます。

- 呼び出し元は、`~/.config/agent-login-broker/token`（初回起動時に 0600 で作る）のトークンを `X-Agent-Login-Broker-Token` ヘッダーで送ります。このトークンはほかのローカルのプロセスやコンテナにツールを使わせないためのもので、ツールを使うエージェントには読めます。
- 任意で `X-Agent-Login-Broker-Pane` ヘッダーに呼び出し元の herdr ペインの id（その `HERDR_PANE_ID`。例: `w1:p2`）を入れると、`open_page` はそのエージェントの隣に開きます。ペインの id の形でない値は無視します。
- 受け付ける `Host` ヘッダーは `127.0.0.1`、`localhost`、`host.docker.internal` です。コンテナからは、`host.docker.internal` がホストの loopback に届く環境（[OrbStack](https://orbstack.dev) で確認）で使えます。Linux の [Docker](https://www.docker.com) では届かないはずです（未確認）。
- 環境変数は読み直さないので、`AGENT_LOGIN_BROKER_SITES` を変えたら再起動してください。

### 環境変数

| 変数 | 意味 |
|---|---|
| `AGENT_LOGIN_BROKER_RECIPES` | レシピファイル（既定は `~/.config/agent-login-broker/recipes.json`）。ここにあるサイトはすべてログインの対象 |
| `AGENT_LOGIN_BROKER_SITES` | 任意。カンマ区切りのホスト名。設定すると、ログインとレシピ作りをこのホストだけに限る。空文字にするとどのサイトも許可しない |
| `AGENT_LOGIN_BROKER_AAC` | `aac` のパス（無ければ `~/.local/bin/aac`、次に `PATH` 上の `aac`） |
| `AGENT_LOGIN_BROKER_HERDR` | `herdr` のパス（既定は `herdr`） |
| `AGENT_LOGIN_BROKER_TERMINAL_BROWSER` | `terminal-browser` のパス（既定は `terminal-browser`） |
| `AGENT_LOGIN_BROKER_NOTIFY` | `off` にすると、承認待ちのデスクトップ通知を出さない |
| `AGENT_LOGIN_BROKER_TOKEN_FILE` | HTTP モードの呼び出し元トークン（既定は `~/.config/agent-login-broker/token`） |

## セキュリティと制限事項

### 守れること

- **パスワードとワンタイムコードを、エージェントの会話、ツールの出力、ログに出さない。** ログインに失敗したときのエラーにそれらが入っていたら（入力したままの形か、URL エンコードした形）、決まった文のエラーに置き換えます。ページがほかの形（base64 など）に変えて書き写したものは見つけられません。
- **認証情報の取り出しは、必ず `aac listen` の承認を通る。** ただし、そこで許可した自動承認の範囲内なら聞かれずに通ります。
- **ブローカーが開いて入力するのは `https://<site>` のページだけ。** ログイン状態は、あなたが `open_page` するまでこのプロセスの中にとどまります。

### 守れないこと

- **身に覚えのない承認要求。** エージェントはあなたと同じユーザーで動くので、`~/.access-protocol/` のペア情報で `aac connect` を自分で実行できます。そのときの承認画面はブローカーのものと見分けがつかないので、**自分で頼んだ直後以外の承認要求はすべて拒否してください。** 自動承認（`[a]`、N 分間）は短くしてください。
- **ページのスクリプト。** パスワードはサイトのページに入力するので、ページ自身のスクリプトと、ページが読み込む外部のスクリプト（解析、広告、CDN）はそれを読めて、どこへでも送れます。手でログインするときと同じ条件です。
- **レシピの書き換え。** レシピファイルはエージェントが書き換えられるので、サイトを足したり、パスワードを入れる欄を変えたりできます。悪意のあるページに誘導されたエージェントが、入力内容を公開してしまう欄を選ぶおそれもあります。次のログインを承認する前にレシピの変更を読み、エージェントが増やせない固定の一覧が欲しければ `AGENT_LOGIN_BROKER_SITES` を設定してください。
- **`propose_recipe` が開くページ。** `AGENT_LOGIN_BROKER_SITES` が無いと、エージェントは公開されている任意の HTTPS のログインページをブローカーのブラウザで開けます（認証情報は使いません）。内部向けの名前とプライベートアドレスは断り、ページを開いている間は別のホストへの移動や転送も止めますが、公開ドメインの名前が内部のアドレスを指している場合は見分けられません。また、ページが読み込む画像、スクリプト、フレームは内部のアドレスを含むどこへでも届きます。
- **terminal-browser に渡したログイン状態。** エージェントも使えるので、そのページでできること（証券会社なら注文も）はエージェントにもできます。危険な操作ができるサイトでは `open_page` を使わないでください。bot 判定の後に terminal-browser に開くログインページに入力したもの（パスワードを含む）も、エージェントが読めます。エージェントにはそのページに触れないよう伝えていますが、それで足りないサイトでは普段のブラウザでログインしてください。Chromium の窓なら、エージェントは触れられません。
- **通信。** `server.mjs` は自分からはマシンの外へ接続せず（HTTP モードのローカルサーバーのほかは、terminal-browser のブラウザへ loopback で接続するだけ）、利用状況の送信もしません。マシンの外へ出るのは、ブローカーの Chromium がサイトとそのページが読み込むものを取りに行く通信と、`aac` が Bitwarden の中継サーバー（既定は `wss://ap.lesspassword.dev`）を通して認証情報を取り出す通信です。中継サーバーでの扱いは Bitwarden の説明に従います。

## 規約・ライセンス・報告

- **利用規約**: 自動操作のブラウザでのログインは、サイトの利用規約に反する場合があります（Google は実際に拒否しています）。規約を確認し、その範囲で使う責任は利用者にあります。使うのは、自分のアカウントか、使う許可を得ているアカウントだけにしてください。他人のアカウントへのログインは違法になる場合があります。
- **提携していません**: このプロジェクトは Bitwarden、GitHub、Google、Cloudflare、そのほかここに名前を挙げた企業とは提携しておらず、推奨も受けていません。名前は対応状況の説明にだけ使っています。
- **脆弱性の報告**: 公開の Issue には書かず、[GitHub の脆弱性報告](https://github.com/qulup-app/agent-login-broker/security/advisories/new)から非公開で報告してください。
- **ライセンス**: MIT。[LICENSE](LICENSE) を参照してください。無保証です。利用は自己責任でお願いします。認証情報の漏えい、アカウントの停止、ログインしたサイトでの意図しない操作が起こりえます。[LICENSE](LICENSE) にあるとおり、利用によって生じた損害について作者は責任を負いません。依存パッケージは npm がそれぞれのライセンス（いずれも寛容なライセンス: MIT、ISC、Apache-2.0、BSD）で入れ、このパッケージには同梱していません。

## 開発

```bash
npm ci
npm test
```

`flake.nix` が Node を提供します（`nix build .#default --out-link .nix/node` で作り、out-link が GC ルートになります）。
