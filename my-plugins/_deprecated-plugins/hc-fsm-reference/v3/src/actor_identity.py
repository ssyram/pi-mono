def actor_identity(actor, plot, bindings):
    root = plot['actors'][actor].get('root', 'root')
    return bindings['session.' + root], 'main' if actor == root else bindings['session.' + actor]
