# shellcheck shell=sh
echo "probe=3"
echo "home=$HOME"
case "$(uname -s)" in
  Linux) linux_probe ;;
  Darwin) darwin_probe ;;
  *) echo "os=unsupported" ;;
esac
exit 0
