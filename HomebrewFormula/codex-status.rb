require "language/node"

class CodexStatus < Formula
  desc "Terminal status viewer for Codex token usage sessions"
  homepage "https://github.com/clockworknet/codex-status"
  url "https://github.com/clockworknet/codex-status/archive/refs/tags/v0.1.1.tar.gz"
  sha256 "87db8037944cc8531b0c5881def3aa4085b83c3a06938b558844c59e39778e46"
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
