# shellcheck shell=sh
echo "probe=2"
echo "home=$HOME"
case "$(uname -s)" in
  Linux) linux_probe ;;
  Darwin) darwin_probe ;;
  *) echo "os=unsupported" ;;
esac
exit 0
