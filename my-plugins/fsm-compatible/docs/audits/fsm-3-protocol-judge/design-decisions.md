# fsm-3 设计差异处置

## 限定确认结果（run f13dcdae-0ca9-467d-a73f-d34b000203aa，tmp-Haokun/glm-5.3-flash，owner授权切换）

**READY。** D3-1～D3-4全部Closed，expectations §2/5/7同步无回归；报告存design-review.md。唯一P2：detailed-design:179与:183/叶子:107的"terminate"同词异指（agent-loop批级hint vs 持久化字段），已在detailed-design §5.4补一句限定，机制行为不变。实施后仍需原合同对照与直接测试；本确认仅针对设计合同，未运行测试。

## 原报告处置（run60df8e97-165e-4b28-9a56-8b75ddb0856a，BLOCKED）

- **D3-1，同意**。实际SDK Edit execute读取非空edits数组，直接调用不运行legacy prepareArguments；现行OC Edit空oldString可创建新文件/父目录。叶子改为原生path+edits，并具体区分空oldString新建、已存在拒绝、wx防覆盖、replaceAll、queue及失败副作用；不开放write/apply_patch名称。
- **D3-2，同意**。SDK ls没有offset且有默认500及先截断差异，不能从其文本推目录完整分页。改为真实readdir/目录或symlink目录后缀、localeCompare排序，再按offset||1、limit??2000切片，保留真实窗口/总数与截断metadata。
- **D3-3，同意**。SDK header/entry timestamp为ISO字符串，原设计整数要求缺转换。明确canonical ISO解析/roundtrip与非负安全整数检查，message/event数值独立验证；raw字符串不改，wire与max只用归一化值；非法不使用当前时间或有效值兜底。
- **D3-4，同意**。总细化仍写一致capture，而叶子要求conflict也正常end。已同步成功capture列表、完整正常批次至少一条有效capture即end（含conflict），保留真实parts交原driver repair；error/length/abort优先。

总细化、叶子和事前expectations同步，未编码fsm3、未调用provider/Web/daemon。本轮只修原B5及直接同合同差异；待原审查者限定确认D3-1～D3-4，不重查首单元/fsm2或新增范围。

类型来源记录：插件SDK包1.0.3；当前依赖已用overrides固定到真实宿主同版本系列。不能用SDK版本推定其transitive版本，部署时仍须检验实际API来源，不因此删降所需功能或改官方源码。

## 实施偏离记录（供对照审查核实）

1. judge会话不使用DefaultResourceLoader/createAgentSession，而用公开raw Agent（pi-agent-core）按回合组装：隔离更强（零扩展/资源/技能加载，无loader依赖），同sid由转写数组seed/吸收延续；system来自每回合请求+schema后缀。2. StructuredOutput工具参数声明为宽松object，精确wire schema以system后缀注入模型。3. children/messages返回readonly数组。以上不改变READY合同（隔离、真实回合、严格envelope、裁决/repair归属），若对照审查认定削弱合同则按其意见修正。
