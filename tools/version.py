# extra_script PlatformIO : injecte FW_VERSION + FW_CHANNEL dans le firmware.
# Source de vérité = git. En CI de release (push d'un tag v*), le checkout est shallow
# et n'a pas les tags → on prend GITHUB_REF_NAME (le tag) au lieu de `git describe`.
#
#   release  : build CI sur un tag       -> FW_VERSION="v0.1.0"            FW_CHANNEL="release"
#   dev      : build local (ou dispatch) -> FW_VERSION="v0.1.0-22-gabc123" FW_CHANNEL="dev"
import os
import subprocess

Import("env")


def resolve_version():
    # GitHub Actions expose ces variables dans tout step `run`. REF_TYPE distingue
    # un vrai tag d'un dispatch manuel sur une branche.
    if os.environ.get("GITHUB_REF_TYPE") == "tag":
        ref = os.environ.get("GITHUB_REF_NAME")
        if ref:
            return ref, "release"
    try:
        desc = subprocess.check_output(
            ["git", "describe", "--tags", "--always", "--dirty"],
            stderr=subprocess.DEVNULL,
        ).decode().strip()
    except Exception:
        desc = "unknown"
    return desc, "dev"


version, channel = resolve_version()
env.Append(CPPDEFINES=[
    ("FW_VERSION", env.StringifyMacro(version)),
    ("FW_CHANNEL", env.StringifyMacro(channel)),
])
print("[version] FW_VERSION=%s FW_CHANNEL=%s" % (version, channel))
