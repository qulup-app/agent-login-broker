{
  description = "agent-login-broker: logs an AI agent into websites with a Bitwarden credential the agent never sees";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (s: f nixpkgs.legacyPackages.${s});
    in {
      # For running from a checkout: `nix build .#default --out-link .nix/node` (README,
      # Development), then point the MCP client at .nix/node/bin/node. The out-link is the GC
      # root: a bare store path would vanish on the next nix-collect-garbage and the MCP server
      # would fail only at the next agent start.
      packages = forAll (pkgs: { default = pkgs.nodejs_22; });
      devShells = forAll (pkgs: { default = pkgs.mkShell { packages = [ pkgs.nodejs_22 ]; }; });
    };
}
