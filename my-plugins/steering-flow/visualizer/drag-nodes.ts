/** Injected into the HTML as a raw <script> string. */
export const dragNodesCode = `
function enableDragNodes(nodeSelection, nodePos, edgeGroups, nodeR) {
  var drag = d3.drag()
    .clickDistance(4)
    .on('start', function() { d3.select(this).raise(); svg.style('cursor','grabbing'); })
    .on('drag', function(evt, d) {
      var np = nodePos[d.id];
      if (!np) return;
      np.x = evt.x;
      np.y = evt.y;
      d3.select(this).attr('transform', 'translate(' + np.x + ',' + np.y + ')');

      // Update connected edges — recompute label midpoint and use polylineSplit
      edgeGroups.each(function(ed) {
        if (ed.src !== d.id && ed.tgt !== d.id) return;
        var group = d3.select(this);
        var sn = nodePos[ed.src], tn = nodePos[ed.tgt];
        if (!sn || !tn) return;
        ed.srcNode.x = sn.x; ed.srcNode.y = sn.y;
        ed.tgtNode.x = tn.x; ed.tgtNode.y = tn.y;
        // Recompute label midpoint
        ed.labelX = (sn.x + tn.x) / 2;
        ed.labelY = (sn.y + tn.y) / 2;
        // Fallback to simple 3-point path during drag (dagre points are stale)
        var sy = sn.y < tn.y ? sn.y + nodeR : sn.y - nodeR;
        var ty = sn.y < tn.y ? tn.y - nodeR : tn.y + nodeR;
        var fallbackPts = [{x:sn.x,y:sy},{x:ed.labelX,y:ed.labelY},{x:tn.x,y:ty}];
        var seg = polylineSplit(fallbackPts, ed.labelX, ed.labelY);
        group.select('.edge-path-1').attr('d', seg.d1);
        group.select('.edge-path-2').attr('d', seg.d2);
        group.select('.edge-label').attr('transform', 'translate(' + ed.labelX + ',' + ed.labelY + ')');
      });
    })
    .on('end', function() { svg.style('cursor','grab'); });
  nodeSelection.call(drag);
}
`;
