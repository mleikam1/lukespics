import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

class BrandMark extends StatelessWidget {
  const BrandMark({
    super.key,
    this.size = 44,
    this.showWordmark = true,
    this.onDark = false,
  });

  final double size;
  final bool showWordmark;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    final foreground = onDark
        ? Colors.white
        : Theme.of(context).colorScheme.onSurface;
    return Semantics(
      label: 'Luke’s Picks',
      image: true,
      child: ExcludeSemantics(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SvgPicture.asset(
              'assets/brand/lukes_picks_mark.svg',
              width: size,
              height: size,
            ),
            if (showWordmark) ...[
              const SizedBox(width: 12),
              Text(
                'LUKE’S\nPICKS',
                style: TextStyle(
                  color: foreground,
                  height: 0.95,
                  fontSize: size * 0.34,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.2,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
