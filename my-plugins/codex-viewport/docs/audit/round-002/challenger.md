# Round 002 Challenger

1. 文档曾把“完整 active frame 单次 terminal write”写得过强；Pi hardware cursor 定位可能追加 cursor-only write。
2. `RuntimeCoordinator.disposePatch(requestAlignment)` 的参数在所有调用点均为 false，是不受设计支撑的死分支。
3. active resize 最终是否既无运行期 clear 又能回到静态原生，需要真实时间点分离证据，不能只看完成后的总日志。
4. direct shutdown 后 session data 和下次静态显示需要实际文件/画面对照，仅静态源码扫描不足。
5. 其余攻击：event mutation、method identity 残留、parallel乱序、重复 restore、forced active reload、terminal epoch reset 和第三方 patch 均已有测试或 fail-open 边界。
