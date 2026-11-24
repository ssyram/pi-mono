# 历史说明：已删除的 HistoryInsertion

插件手工 top scroll-region history insertion 已删除。managed renderer不发送history `CRLF`、scroll-region设置或以finalized block为由的stable-row滚动。

静态prefix由native baseline adoption提交：它已完整存在于physical frame，插件只把同一frame采纳为Pi baseline，不二次render。成功后，若agent仍运行，插件DSR recapture并从首个unfinished component重建managed suffix；失败则留在native。完整事务、证明和回归见 `../fixes/atomic-block-native-commit.md`。
