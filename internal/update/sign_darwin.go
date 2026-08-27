//go:build darwin

package update

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// certName is the identity plxr presents itself with on this machine.
const certName = "plxr Code Signing"

// resign signs the swapped-in bundle with a stable local identity.
//
// Without it the app only carries an ad-hoc signature, and its identity towards
// macOS is the code hash — which changes with every build. The consequence: after
// every update the system asks for permissions again, as if it were a stranger.
// With a fixed certificate the identity reads "identifier + certificate leaf"
// and stays the same across all versions.
//
// The certificate is self-issued and lives only in this user's keychain. It does
// not make the app more trustworthy — it only makes it
// wiedererkennbar.
func resign(ort string) error {
	if !strings.HasSuffix(ort, ".app") {
		return nil // only bundles carry a signature
	}
	if err := ensureCertificate(); err != nil {
		return err
	}
	// Without this Gatekeeper considers the file downloaded and blocks it.
	exec.Command("xattr", "-dr", "com.apple.quarantine", ort).Run()

	return exec.Command("codesign", "--force", "--deep",
		"--sign", certName, "--identifier", "dev.plxr.app", ort).Run()
}

func ensureCertificate() error {
	out, err := exec.Command("security", "find-identity", "-p", "codesigning").Output()
	if err == nil && strings.Contains(string(out), certName) {
		return nil
	}

	tmp, err := os.MkdirTemp("", "plxr-zert-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)

	cnf := filepath.Join(tmp, "ext.cnf")
	os.WriteFile(cnf, []byte(`[req]
distinguished_name = dn
prompt = no
x509_extensions = v3
[dn]
CN = `+certName+`
[v3]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
`), 0o600)

	key := filepath.Join(tmp, "key.pem")
	crt := filepath.Join(tmp, "cert.pem")
	if err := exec.Command("openssl", "req", "-x509", "-newkey", "rsa:2048",
		"-keyout", key, "-out", crt, "-days", "7300", "-nodes", "-config", cnf).Run(); err != nil {
		return err
	}

	p12 := filepath.Join(tmp, "id.p12")
	// macOS cannot read the newer openssl defaults.
	if err := exec.Command("openssl", "pkcs12", "-export",
		"-inkey", key, "-in", crt, "-out", p12,
		"-passout", "pass:plxr", "-name", certName,
		"-macalg", "sha1", "-keypbe", "PBE-SHA1-3DES", "-certpbe", "PBE-SHA1-3DES").Run(); err != nil {
		return err
	}

	home, _ := os.UserHomeDir()
	return exec.Command("security", "import", p12,
		"-k", filepath.Join(home, "Library", "Keychains", "login.keychain-db"),
		"-P", "plxr", "-T", "/usr/bin/codesign").Run()
}
