# Korábbi, elvetett SenseNet-bővítményes proof

Joe 2026-11-06-i döntése: a képfunkciót a kliensalkalmazásban kell megoldani, SenseNet-bővítmény nélkül. A korábbi saját handlerek, observer, natív képműveletek, képtípusok és Skia-dekóder kikerülnek a PR-ból. Nem telepítési előfeltételek.

A korábbi proof dokumentuma és kódja változatlanul megtalálható a Git történetében: [8296b618 – korábbi M0-jelentés](https://github.com/VargaJoe/timeline-theories/blob/8296b61875ef7fea4f1040590773e7c6099cf16d/docs/image-variants-m0-verification.md). A régi provisioning- és natív képsmoke-parancsokat ne futtasd az új megoldáshoz.

Az ottani képvédelmi/natív eredmények kizárólag a régi architektúrát igazolták; a standard API-ra épülő változathoz új funkcionális bizonyíték kell. Az eredeti adatok és helyi volume-ok megőrzése az átalakítás része.

Aktuális modell, használat és ellenőrzés: [kliens/app alapú képváltozatok](image-variants-usage-and-rollout.md). Aktuális döntések: [borítóterv](timeline-cover-variants-plan.md).
