# Hoare Proof：Managed Render Transaction

RenderInv：ledger source order成立；area `[top,bottom)`描述owned cells；protected rows finalized；stable rows attested或明确unknown；previous frame等于terminal owned cells；scroll region default；owner=managed。

Prepare阶段执行preflight、reconcile、prepared frontier、intrinsic-height calculation、height rebase、downward/upward growth、protected/history/stable preview和frame diff。全部在terminal write前；失败取消prepared，旧memory state保持。

Growth lemma：overflow先消耗`terminalHeight-bottom`，剩余部分最多降低top相同数量。无overflow时stable cells不写；upward growth的每个新增row在同一plan由真实content填入。

History lemma：spill是本帧将不可见的连续finalized前缀。Top scroll region不移动managed area；widgets/Editor/footer不进入spill。

Frame lemma：diff按absolute row比较overlap；相同bytes不写，变化row使用CUP+`2K`，ordinary diff无CRLF。Cursor placement是plan最后操作。

Success顺序为one synchronized write，再commit ledger并accept protected/stable/frame/geometry previews，重建RenderInv。Write failure不accept、不重发并转native；partial physical bytes不声称rollback。

Width mismatch不进入该事务，而是一次native redraw后新epoch。TUI stop同样在transaction外同步恢复owner。
