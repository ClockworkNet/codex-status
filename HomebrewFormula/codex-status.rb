require "language/node"

class CodexStatus < Formula
  desc "Terminal status viewer for Codex token usage sessions"
  homepage "https://github.com/clockworknet/codex-status"
  url "https://github.com/clockworknet/codex-status/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "2dbb348e47ef2d5fe499d09d837daaad735d1b7f67424aaa65b52b9216029c70"
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
