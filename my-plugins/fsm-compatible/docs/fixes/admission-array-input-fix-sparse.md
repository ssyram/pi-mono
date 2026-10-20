# 准入输入：稀疏数组与冻结断言修正

## 1. 现象与复现

首次针对性测试21项中19通过、2失败；类型检查另有fixture narrowing错误。`parsePolicyInput({allowedAgentNames:new Array(1),requiredExtensions:[],maxDepth:8})` 返回ok并复制undefined，预期invalid-input。冻结测试期望Reflect.set抛异常，实际返回false。

## 2. 根因

Array.every跳过缺失slot，不能证明每个位置都是标识符。定义snapshot仅用数字regex判断额外array key，会误接受非canonical索引“00”。Reflect.set是返回成功布尔值的反射API，失败不等于throw。assert.equal(result.ok,true)已将result收窄为success，随后失败分支成为never。

## 3. 参考行为

实际Node26.8.1测试回执直接给出稀疏数组ok结果与Reflect缺少expected exception；数组真实slot必须通过own property descriptor验证，不依赖every对holes的行为。非canonical额外属性不是JSON数组slot。

## 4. 修正方案

新增具体JSON data-array检查：数组ownkeys数量恰为length+1，每个索引有enumerable data descriptor；先排除holes/getters/额外keys，再运行元素谓词。准入、mandatory payload、definition snapshot复用此同一合同。冻结断言改为Reflect.set=false并保持原snapshot未变。fixture用assert.ok成功收窄，不再访问never分支。

## 5. 正确性论证

每个实际slot都必须存在且为data，ownkeys计数排除额外属性，因此没有holes可被every漏过，读取不会执行slot getter；失败在policy输出前，不能扩大派遣集合。Readonly snapshot的合同仍是不可变，而不是特定反射函数必须throw。

## 6. 测试

保留原稀疏输入测试；增加/保留accessor及“00”定义数组反例；冻结操作验证false和原输出不变；全部原测试重跑。修正后状态：原全套21/21及插件tsc通过；后续C1新增回归后最新22/22。

## 7. 代码

parse-policy-input、snapshot-agent-definition、read-persisted-binding、build-admission-policy引用具体data-array guard；test/admission-policy.test.ts与fixture只修正被证实错误的断言/narrowing。没有删除失败用例。

## 8. 文档

原合同要求unknown输入正确验证及输出不可变，未变更契约/错误枚举；本文件保存实现根因与回归依据。实施处置与测试回执另在首单元报告记录。
