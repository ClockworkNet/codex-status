require "language/node"

class CodexStatus < Formula
  desc "Terminal status viewer for Codex token usage sessions"
  homepage "https://github.com/clockworknet/codex-status"
  url "https://github.com/clockworknet/codex-status/archive/refs/tags/v0.1.4.tar.gz"
  sha256 "9f4d41322b206ca2df7d247914d70b5fa5d6b80464b02de499b22ddf6fedd73d"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    output = shell_output("#{bin}/codex-status --version")
    assert_match "codex-status v#{version}", output
  end
end
