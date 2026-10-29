package analysis

import "github.com/sojupie/ui-motion/internal/motion"

type Reference = motion.Reference

func ReferencePresets() []Reference                { return motion.ReferencePresets() }
func ReferencePreset(id string) (Reference, error) { return motion.ReferencePreset(id) }
