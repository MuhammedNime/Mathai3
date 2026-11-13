// ══════════════════════════════════════════════════════════════════════════
//                  ALGEBRA SOLVER - CORE IMPLEMENTATION
// ══════════════════════════════════════════════════════════════════════════

import { normalizeMathExpression, toLatinDigits } from '../../tools/mathNormalize.js';

const getMath = () => (typeof window !== 'undefined' ? window.math : globalThis.math);

const normalizeMathInput = (expr) => {
    return normalizeMathExpression(expr, { removeSpaces: true, preferExponent: true });
};

const fmtNum = (n, decimals = 6) => {
    if (!Number.isFinite(n)) return String(n);
    const cleaned = Math.abs(n) < 1e-10 ? 0 : Number(n.toFixed(decimals));
    return String(cleaned);
};

const splitEquationSides = (equation) => {
    const raw = String(equation || '');
    const parts = raw.split('=');
    if (parts.length === 1) return { lhs: raw, rhs: '0' };
    return { lhs: parts[0], rhs: parts.slice(1).join('=') };
};

const buildZeroExpression = (equation) => {
    const { lhs, rhs } = splitEquationSides(equation);
    return `(${lhs})-(${rhs})`;
};

const nearlyEqual = (a, b, tol = 1e-6) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    const diff = Math.abs(a - b);
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    return diff <= tol * scale;
};

const safeEvalAt = (expr, variable, value) => {
    try {
        const math = getMath();
        return math.evaluate(expr, { [variable]: value });
    } catch (e) {
        return NaN;
    }
};

const detectVariable = (expr, fallback = 'x') => {
    const cleaned = String(expr || '').replace(/\b(sin|cos|tan|cot|sec|csc|asin|acos|atan|sinh|cosh|tanh|sqrt|cbrt|abs|log10|log2|log|ln|exp|pi|gcd|lcm)\b/gi, '');
    const hasX = /x/i.test(cleaned);
    const hasY = /y/i.test(cleaned);
    if (hasY && !hasX) return 'y';
    const single = cleaned.match(/\b([a-z])\b/i);
    if (single && !hasX) return single[1];
    return fallback || 'x';
};

const fitLinearCoeffs = (expr, variable = 'x') => {
    const f0 = safeEvalAt(expr, variable, 0);
    const f1 = safeEvalAt(expr, variable, 1);
    const f2 = safeEvalAt(expr, variable, 2);
    if (!Number.isFinite(f0) || !Number.isFinite(f1) || !Number.isFinite(f2)) return null;
    const a = f1 - f0;
    const b = f0;
    const expected2 = 2 * a + b;
    if (!nearlyEqual(f2, expected2, 1e-4)) return null;
    return { a, b };
};

const fitQuadraticCoeffs = (expr, variable = 'x') => {
    const f0 = safeEvalAt(expr, variable, 0);
    const f1 = safeEvalAt(expr, variable, 1);
    const f2 = safeEvalAt(expr, variable, 2);
    const f3 = safeEvalAt(expr, variable, 3);
    if (![f0, f1, f2, f3].every(Number.isFinite)) return null;
    const a = (f2 - 2 * f1 + f0) / 2;
    const b = f1 - a - f0;
    const c = f0;
    const expected3 = 9 * a + 3 * b + c;
    if (!nearlyEqual(f3, expected3, 1e-3)) return null;
    return { a, b, c };
};

const evaluateReal = (expr, variable, x) => {
    try {
        const math = getMath();
        const v = math.evaluate(expr, { [variable]: x });
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        if (v && typeof v.re === 'number' && typeof v.im === 'number') {
            if (Math.abs(v.im) < 1e-8 && Number.isFinite(v.re)) return v.re;
        }
    } catch (e) { /* ignore */ }
    return NaN;
};

const bisectRoot = (expr, variable, a, b, fa, fb, maxIter = 60) => {
    let left = a;
    let right = b;
    let fLeft = fa;
    for (let i = 0; i < maxIter; i++) {
        const mid = (left + right) / 2;
        const fMid = evaluateReal(expr, variable, mid);
        if (!Number.isFinite(fMid)) break;
        if (Math.abs(fMid) < 1e-9) return mid;
        if (fLeft * fMid <= 0) {
            right = mid;
        } else {
            left = mid;
            fLeft = fMid;
        }
        if (Math.abs(right - left) < 1e-9) break;
    }
    return (left + right) / 2;
};

const dedupeRoots = (roots, tol = 1e-4) => {
    const sorted = roots.slice().filter(Number.isFinite).sort((a, b) => a - b);
    const out = [];
    for (const r of sorted) {
        if (!out.length || Math.abs(out[out.length - 1] - r) > tol) out.push(r);
    }
    return out;
};

const findRootsNumeric = (expr, variable = 'x', options = {}) => {
    const rangeBase = options.range || 20;
    const samplesBase = options.samples || 800;
    const maxRanges = options.maxRanges || 3;
    const tol = options.tol || 1e-6;
    const roots = [];

    for (let k = 0; k < maxRanges; k++) {
        const range = rangeBase * Math.pow(2, k);
        const samples = samplesBase + k * 400;
        const step = (2 * range) / samples;
        let prevX = -range;
        let prevY = evaluateReal(expr, variable, prevX);

        for (let i = 1; i <= samples; i++) {
            const x = -range + i * step;
            const y = evaluateReal(expr, variable, x);

            if (Number.isFinite(prevY) && Number.isFinite(y)) {
                if (Math.abs(y) < tol) {
                    roots.push(x);
                } else if (prevY === 0) {
                    roots.push(prevX);
                } else if (prevY * y < 0) {
                    const root = bisectRoot(expr, variable, prevX, x, prevY, y);
                    roots.push(root);
                }
            }

            prevX = x;
            prevY = y;
        }

        if (roots.length) break;
    }

    return dedupeRoots(roots, 1e-4);
};

const gcdInts = (a, b) => {
    let x = Math.abs(Math.round(a));
    let y = Math.abs(Math.round(b));
    while (y) {
        [x, y] = [y, x % y];
    }
    return x || 1;
};

const formatFactorTerm = (variable, root) => {
    const r = Math.abs(root) < 1e-9 ? 0 : root;
    if (r === 0) return variable;
    if (r > 0) return `(${variable} - ${fmtNum(r, 4)})`;
    return `(${variable} + ${fmtNum(Math.abs(r), 4)})`;
};

const formatStandardPoly = (a, b, c, v = 'x') => {
    const parts = [];
    if (Math.abs(a) > 1e-10) {
        const aStr = a === 1 ? '' : a === -1 ? '-' : fmtNum(a, 4);
        parts.push(`${aStr}${v}^2`);
    }
    if (Math.abs(b) > 1e-10) {
        const absB = Math.abs(b);
        const bStr = absB === 1 ? '' : fmtNum(absB, 4);
        const sign = b > 0 ? (parts.length ? ' + ' : '') : (parts.length ? ' - ' : '-');
        parts.push(`${sign}${bStr}${v}`);
    }
    if (Math.abs(c) > 1e-10 || parts.length === 0) {
        const sign = c >= 0 ? (parts.length ? ' + ' : '') : (parts.length ? ' - ' : '-');
        parts.push(`${sign}${fmtNum(Math.abs(c), 4)}`);
    }
    return parts.join('');
};

export const algebraSolver = {

    utils: {
        toLatex: (node) => node ? node.toTex({ parenthesis: 'keep' }) : '',
        formatNumber: (n) => fmtNum(n, 4),
        parse: (expr) => getMath().parse(expr),
        normalize: (expr) => normalizeMathInput(expr)
    },

    polynomials: {
        addition: {
            solve(data) {
                const math = getMath();
                const { expr1, expr2 } = data;
                const steps = [];
                try {
                    const node1 = math.parse(normalizeMathInput(expr1));
                    const node2 = math.parse(normalizeMathInput(expr2));
                    steps.push({
                        explanation: 'كتابة المقدارين لجمعهما:',
                        equation: `(${node1.toTex()}) + (${node2.toTex()})`
                    });
                    const sumNode = math.add(node1, node2);
                    const simplified = math.simplify(sumNode);
                    steps.push({
                        explanation: 'تجميع الحدود المتشابهة وتبسيط الناتج:',
                        equation: simplified.toTex()
                    });
                    return {
                        title: 'جمع كثيرات الحدود',
                        finalResult: simplified.toTex(),
                        steps,
                        lessonLink: '/library/algebra/polynomials'
                    };
                } catch (e) {
                    return { error: `خطأ في الجمع: ${e.message}` };
                }
            }
        },

        multiplication: {
            solve(data) {
                const math = getMath();
                const { expr1, expr2 } = data;
                const steps = [];
                try {
                    const node1 = math.parse(normalizeMathInput(expr1));
                    const node2 = math.parse(normalizeMathInput(expr2));
                    steps.push({
                        explanation: 'ضرب المقدارين بتوزيع الحدود:',
                        equation: `(${node1.toTex()}) \\cdot (${node2.toTex()})`
                    });
                    const expanded = math.rationalize(math.multiply(node1, node2));
                    steps.push({
                        explanation: 'تجميع الحدود المتشابهة:',
                        equation: expanded.toTex()
                    });
                    return {
                        title: 'ضرب كثيرات الحدود',
                        finalResult: expanded.toTex(),
                        steps
                    };
                } catch (e) {
                    return { error: `خطأ في الضرب: ${e.message}` };
                }
            }
        },

        expanding: {
            solve(data) {
                const math = getMath();
                const rawExpr = data.expression || data.equation || '';
                const steps = [];
                try {
                    const norm = normalizeMathInput(rawExpr);
                    if (!norm) return { error: 'يرجى إدخال مقدار جبري للفك.' };

                    let origTex = norm;
                    try { origTex = math.parse(norm).toTex(); } catch (e) { /* ignore */ }
                    steps.push({
                        explanation: 'المقدار الأصلي قبل الفك:',
                        equation: origTex
                    });

                    let expandedStr = '';
                    let expandedTex = '';

                    if (typeof nerdamer !== 'undefined') {
                        try {
                            const nRes = nerdamer(`expand(${norm})`);
                            expandedStr = nRes.toString();
                            expandedTex = typeof nRes.toTeX === 'function' ? nRes.toTeX() : expandedStr;
                        } catch (e) { /* fallback to mathjs */ }
                    }

                    if (!expandedTex) {
                        const rat = math.rationalize(norm);
                        expandedStr = rat.toString();
                        expandedTex = rat.toTex();
                    }

                    steps.push({
                        explanation: 'توزيع الأقواس وتجميع الحدود المتشابهة:',
                        equation: expandedTex
                    });

                    return {
                        title: 'فك وتبسيط المقدار الجبري',
                        finalResult: expandedTex,
                        rawResult: expandedStr,
                        steps
                    };
                } catch (e) {
                    return { error: `خطأ في فك الأقواس: ${e.message}` };
                }
            }
        },

        factoring: {
            solve(data) {
                const math = getMath();
                const rawInput = (data.expression || data.equation || '').split('=')[0].trim();
                const steps = [];

                try {
                    const norm = normalizeMathInput(rawInput);
                    if (!norm) return { error: 'يرجى إدخال مقدار للتحليل.' };

                    const variable = detectVariable(norm, 'x');
                    let origTex = norm;
                    try { origTex = math.parse(norm).toTex(); } catch (e) { /* ignore */ }

                    steps.push({
                        explanation: 'كتابة المقدار المراد تحليله:',
                        equation: origTex
                    });

                    // 1) محاولة تحليل تربيعي تحليلي لتقديم خطوات تعليمية واضحة بالعربية
                    const quad = fitQuadraticCoeffs(norm, variable);
                    if (quad && Math.abs(quad.a) > 1e-10) {
                        const { a, b, c } = quad;
                        const delta = b * b - 4 * a * c;

                        // فرق بين مربعين: a*x^2 - |c| = 0
                        if (Math.abs(b) < 1e-10 && c < 0 && a > 0) {
                            const sqrtA = Math.sqrt(a);
                            const sqrtC = Math.sqrt(-c);
                            const coefA = Math.abs(sqrtA - 1) < 1e-9 ? '' : fmtNum(sqrtA, 4);
                            const factTex = `(${coefA}${variable} - ${fmtNum(sqrtC, 4)})(${coefA}${variable} + ${fmtNum(sqrtC, 4)})`;
                            steps.push({
                                explanation: 'نلاحظ أن المقدار على صورة فرق بين مربعين $A^2 - B^2 = (A - B)(A + B)$:',
                                equation: `${origTex} = ${factTex}`
                            });
                            return {
                                title: 'تحليل فرق بين مربعين',
                                finalResult: factTex,
                                steps
                            };
                        }

                        // إخراج عامل مشترك x عندما c == 0
                        if (Math.abs(c) < 1e-10) {
                            const aStr = a === 1 ? '' : a === -1 ? '-' : fmtNum(a, 4);
                            const bSign = b >= 0 ? '+' : '-';
                            const factTex = `${variable}(${aStr}${variable} ${bSign} ${fmtNum(Math.abs(b), 4)})`;
                            steps.push({
                                explanation: `إخراج العامل المشترك $${variable}$:`,
                                equation: factTex
                            });
                            return {
                                title: 'تحليل بإخراج العامل المشترك',
                                finalResult: factTex,
                                steps
                            };
                        }

                        if (delta >= 0) {
                            const r1 = (-b + Math.sqrt(delta)) / (2 * a);
                            const r2 = (-b - Math.sqrt(delta)) / (2 * a);
                            const rootsSorted = [r1, r2].sort((u, v) => u - v);
                            steps.push({
                                explanation: 'حساب المميز $\\Delta = b^2 - 4ac$ لإيجاد الجذور:',
                                equation: `\\Delta = (${fmtNum(b, 4)})^2 - 4(${fmtNum(a, 4)})(${fmtNum(c, 4)}) = ${fmtNum(delta, 4)}`
                            });

                            let factTex = '';
                            if (Math.abs(delta) < 1e-9) {
                                const term = formatFactorTerm(variable, rootsSorted[0]);
                                const lead = Math.abs(a - 1) < 1e-9 ? '' : (Math.abs(a + 1) < 1e-9 ? '-' : fmtNum(a, 4));
                                factTex = `${lead}${term}^2`;
                                steps.push({
                                    explanation: 'بما أن المميز يساوي صفراً، فالمقدار مربع كامل:',
                                    equation: factTex
                                });
                            } else {
                                const lead = Math.abs(a - 1) < 1e-9 ? '' : (Math.abs(a + 1) < 1e-9 ? '-' : fmtNum(a, 4));
                                const t1 = formatFactorTerm(variable, rootsSorted[0]);
                                const t2 = formatFactorTerm(variable, rootsSorted[1]);
                                factTex = `${lead}${t1}${t2}`;
                                steps.push({
                                    explanation: `الجذران هما $${variable}_1 = ${fmtNum(rootsSorted[0], 4)}$ و $${variable}_2 = ${fmtNum(rootsSorted[1], 4)}$، نكتب الصيغة التحليلية $a(${variable}-${variable}_1)(${variable}-${variable}_2)$:`,
                                    equation: factTex
                                });
                            }

                            return {
                                title: 'تحليل كثيرة الحدود التربيعية',
                                finalResult: factTex,
                                steps
                            };
                        }
                    }

                    // 2) تحليل خطي بسيط بإخراج العامل المشترك مثل 6x + 9
                    const lin = fitLinearCoeffs(norm, variable);
                    if (lin && Math.abs(lin.a) > 1e-10) {
                        if (Number.isInteger(lin.a) && Number.isInteger(lin.b) && lin.b !== 0) {
                            const g = gcdInts(lin.a, lin.b);
                            if (g > 1) {
                                const qa = lin.a / g;
                                const qb = lin.b / g;
                                const aStr = qa === 1 ? '' : qa === -1 ? '-' : String(qa);
                                const bSign = qb >= 0 ? '+' : '-';
                                const factTex = `${g}(${aStr}${variable} ${bSign} ${Math.abs(qb)})`;
                                steps.push({
                                    explanation: `إخراج القاسم المشترك الأكبر (${g}) بين المعاملات:`,
                                    equation: factTex
                                });
                                return {
                                    title: 'تحليل بإخراج العامل المشترك',
                                    finalResult: factTex,
                                    steps
                                };
                            }
                        }
                    }

                    // 3) محاولة عبر Nerdamer لأي كثيرات حدود أعلى درجة
                    if (typeof nerdamer !== 'undefined') {
                        try {
                            const factored = nerdamer(`factor(${norm})`);
                            const factoredStr = factored.toString();
                            const factoredTex = typeof factored.toTeX === 'function' ? factored.toTeX() : factoredStr;
                            if (factoredStr && factoredStr !== norm) {
                                steps.push({
                                    explanation: 'تطبيق التحليل الرمزي للعوامل الأولية:',
                                    equation: factoredTex
                                });
                                return {
                                    title: 'تحليل كثيرة الحدود إلى عوامل',
                                    finalResult: factoredTex,
                                    steps
                                };
                            }
                        } catch (e) { /* ignore */ }
                    }

                    return { error: 'المقدار غير قابل للتحليل في الأعداد الحقيقية البسيطة.' };
                } catch (e) {
                    return { error: `خطأ في التحليل: ${e.message}` };
                }
            }
        }
    },

    equations: {
        linear: {
            solve(data) {
                const rawInput = data.equation || data.expression || '';
                const variableHint = data.variable || 'x';
                const steps = [];

                try {
                    const normalizedEq = normalizeMathInput(rawInput);
                    const zeroExpr = normalizeMathInput(buildZeroExpression(normalizedEq));
                    const varName = detectVariable(zeroExpr, variableHint);

                    let [lhs, rhs] = normalizedEq.split('=').map((s) => s.trim());
                    if (!rhs) rhs = '0';

                    steps.push({
                        explanation: 'المعادلة الأصلية:',
                        equation: `${lhs} = ${rhs}`
                    });

                    // إذا تبيّن أنها تربيعية فعلياً، وجّهها للحلّال التربيعي تلقائياً
                    const quadCheck = fitQuadraticCoeffs(zeroExpr, varName);
                    if (quadCheck && Math.abs(quadCheck.a) > 1e-9) {
                        return algebraSolver.equations.quadratic.solve({
                            ...data,
                            equation: rawInput,
                            variable: varName
                        });
                    }

                    const coeffs = fitLinearCoeffs(zeroExpr, varName);
                    if (coeffs) {
                        const { a, b } = coeffs;
                        steps.push({
                            explanation: `تبسيط المعادلة إلى الصورة القياسية $a${varName} + b = 0$:`,
                            equation: `${fmtNum(a)}${varName} ${b >= 0 ? '+' : '-'} ${fmtNum(Math.abs(b))} = 0`
                        });

                        if (Math.abs(a) < 1e-10) {
                            if (Math.abs(b) < 1e-10) {
                                return {
                                    title: 'معادلة خطية متطابقة',
                                    finalResult: `\\text{عدد لا نهائي من الحلول } (${varName} \\in \\mathbb{R})`,
                                    steps
                                };
                            }
                            return { error: 'لا يوجد حل لأن المعادلة تؤدي إلى تناقض.' };
                        }

                        const solution = -b / a;
                        const solStr = fmtNum(solution);
                        steps.push({
                            explanation: `عزل المتغير $${varName}$ بقسمة الطرفين على $${fmtNum(a)}$:`,
                            equation: `${varName} = \\frac{${fmtNum(-b)}}{${fmtNum(a)}} = ${solStr}`
                        });

                        return {
                            title: 'حل معادلة خطية',
                            finalResult: `${varName} = ${solStr}`,
                            steps
                        };
                    }

                    if (typeof nerdamer !== 'undefined') {
                        const sol = nerdamer.solve(normalizedEq, varName);
                        const solution = sol.toString().replace(/[\[\]]/g, '');
                        steps.push({
                            explanation: 'عزل المتغير وحل المعادلة:',
                            equation: `${varName} = ${solution}`
                        });
                        return {
                            title: 'حل المعادلة',
                            finalResult: `${varName} = ${solution}`,
                            steps
                        };
                    }

                    return algebraSolver.equations.numeric.solve({ equation: rawInput, variable: varName });
                } catch (e) {
                    return { error: `خطأ في حل المعادلة: ${e.message}` };
                }
            }
        },

        quadratic: {
            solve(data) {
                let a, b, c;
                let variable = data.variable || 'x';
                const steps = [];

                if (data.a !== undefined) {
                    a = Number(data.a);
                    b = Number(data.b);
                    c = Number(data.c);
                } else {
                    const rawEq = data.equation || data.expression || '';
                    const normalizedEq = normalizeMathInput(rawEq);
                    const zeroExpr = normalizeMathInput(buildZeroExpression(normalizedEq));
                    variable = detectVariable(zeroExpr, variable);
                    const coeffs = fitQuadraticCoeffs(zeroExpr, variable);
                    if (!coeffs) {
                        const linearCoeffs = fitLinearCoeffs(zeroExpr, variable);
                        if (linearCoeffs && Math.abs(linearCoeffs.a) > 1e-10) {
                            return algebraSolver.equations.linear.solve({
                                equation: rawEq,
                                variable
                            });
                        }
                        return algebraSolver.equations.numeric.solve({ equation: rawEq, variable });
                    }
                    a = coeffs.a;
                    b = coeffs.b;
                    c = coeffs.c;

                    if (Math.abs(a) < 1e-10) {
                        return algebraSolver.equations.linear.solve({
                            equation: rawEq,
                            variable
                        });
                    }
                }

                steps.push({
                    explanation: 'المعادلة التربيعية في الصورة القياسية $ax^2 + bx + c = 0$:',
                    equation: `${formatStandardPoly(a, b, c, variable)} = 0`
                });

                const delta = b * b - 4 * a * c;
                steps.push({
                    explanation: 'حساب المميز $\\Delta = b^2 - 4ac$:',
                    equation: `\\Delta = (${fmtNum(b)})^2 - 4(${fmtNum(a)})(${fmtNum(c)}) = ${fmtNum(delta)}`
                });

                let roots = [];
                if (delta > 1e-10) {
                    const x1 = (-b + Math.sqrt(delta)) / (2 * a);
                    const x2 = (-b - Math.sqrt(delta)) / (2 * a);
                    roots = [x1, x2].sort((u, v) => u - v);
                    steps.push({
                        explanation: 'بما أن $\\Delta > 0$، يوجد جذران حقيقيان مختلفان باستخدام القانون العام:',
                        equation: `${variable} = \\frac{-b \\pm \\sqrt{\\Delta}}{2a} = \\frac{-(${fmtNum(b)}) \\pm \\sqrt{${fmtNum(delta)}}}{2(${fmtNum(a)})}`
                    });
                    steps.push({
                        explanation: 'إيجاد قيمة الجذرين:',
                        equation: `${variable}_1 = ${fmtNum(roots[0], 4)}, \\quad ${variable}_2 = ${fmtNum(roots[1], 4)}`
                    });
                } else if (Math.abs(delta) <= 1e-10) {
                    const x = -b / (2 * a);
                    roots = [x];
                    steps.push({
                        explanation: 'بما أن $\\Delta = 0$، يوجد جذر حقيقي واحد مضاعف:',
                        equation: `${variable} = \\frac{-b}{2a} = \\frac{-(${fmtNum(b)})}{2(${fmtNum(a)})} = ${fmtNum(x, 4)}`
                    });
                } else {
                    const realPart = -b / (2 * a);
                    const imagPart = Math.abs(Math.sqrt(-delta) / (2 * a));
                    const rStr = Math.abs(realPart) < 1e-9 ? '' : `${fmtNum(realPart, 4)} `;
                    const x1 = rStr ? `${rStr}+ ${fmtNum(imagPart, 4)}i` : `${fmtNum(imagPart, 4)}i`;
                    const x2 = rStr ? `${rStr}- ${fmtNum(imagPart, 4)}i` : `-${fmtNum(imagPart, 4)}i`;
                    steps.push({
                        explanation: 'بما أن $\\Delta < 0$، للمعادلة جذران مركبان مترافقان:',
                        equation: `${variable}_{1,2} = \\frac{-b \\pm i\\sqrt{|\\Delta|}}{2a}`
                    });
                    steps.push({
                        explanation: 'الحلول المركبة:',
                        equation: `${variable}_1 = ${x1}, \\quad ${variable}_2 = ${x2}`
                    });
                    return {
                        title: 'حل المعادلة التربيعية (جذور مركبة)',
                        finalResult: `${variable} \\in \\{ ${x1},\\; ${x2} \\}`,
                        steps
                    };
                }

                return {
                    title: 'حل المعادلة التربيعية',
                    finalResult: `${variable} \\in \\{ ${roots.map((n) => fmtNum(n, 4)).join(', ')} \\}`,
                    steps
                };
            }
        },

        numeric: {
            solve(data) {
                const equation = data.equation || data.expression || '';
                const steps = [];
                try {
                    const normalizedEq = normalizeMathInput(equation);
                    const zeroExpr = normalizeMathInput(buildZeroExpression(normalizedEq));
                    const variable = detectVariable(zeroExpr, data.variable || 'x');

                    steps.push({
                        explanation: 'تحويل المعادلة إلى صورة $f(x)=0$:',
                        equation: `${zeroExpr} = 0`
                    });

                    const roots = findRootsNumeric(zeroExpr, variable, { range: 25, samples: 900 });
                    if (!roots.length) {
                        return { error: 'لم يتم العثور على حلول حقيقية ضمن النطاق العددي المفحوص.' };
                    }

                    const formatted = roots.map((r) => fmtNum(r, 5));
                    steps.push({
                        explanation: 'البحث العددي الدقيق عن الجذور الحقيقية:',
                        equation: `${variable} \\approx ${formatted.join(', ')}`
                    });

                    return {
                        title: 'حل عددي لمعادلة غير خطية',
                        finalResult: `${variable} \\approx \\{ ${formatted.join(', ')} \\}`,
                        steps
                    };
                } catch (e) {
                    return { error: `خطأ في الحل العددي: ${e.message}` };
                }
            }
        },

        systemsLinear: {
            solve(data) {
                const math = getMath();
                const steps = [];
                let A = data.matrixA;
                let B = data.vectorB;

                if ((!Array.isArray(A) || !Array.isArray(B)) && (data.expression || data.equation)) {
                    const raw = String(data.expression || data.equation || '').trim();
                    const eqParts = raw.split(/\r?\n|;|،|,(?=[^()]*=)|\b(?:and|و)\b/i).map((s) => s.trim()).filter((s) => s.includes('='));
                    if (eqParts.length >= 2) {
                        const parsedRows = [];
                        const parsedB = [];
                        for (let i = 0; i < 2; i++) {
                            const { lhs, rhs } = splitEquationSides(eqParts[i]);
                            const zeroExpr = normalizeMathInput(`(${lhs})-(${rhs})`);
                            const c0 = math.evaluate(zeroExpr, { x: 0, y: 0 });
                            const ax = math.evaluate(zeroExpr, { x: 1, y: 0 }) - c0;
                            const by = math.evaluate(zeroExpr, { x: 0, y: 1 }) - c0;
                            if ([c0, ax, by].every(Number.isFinite)) {
                                parsedRows.push([ax, by]);
                                parsedB.push(-c0);
                            }
                        }
                        if (parsedRows.length === 2) {
                            A = parsedRows;
                            B = parsedB;
                        }
                    }
                }

                if (!Array.isArray(A) || !Array.isArray(B) || A.length !== 2 || A[0].length !== 2) {
                    return { error: 'حالياً يدعم الحل السريع أنظمة 2×2. استخدم ورشة المصفوفات للأنظمة الأكبر.' };
                }

                steps.push({
                    explanation: 'كتابة نظام المعادلات بصيغة المصفوفات $AX = B$:',
                    equation: `\\begin{pmatrix}${A[0][0]} & ${A[0][1]}\\\\${A[1][0]} & ${A[1][1]}\\end{pmatrix}\\begin{pmatrix}x\\\\y\\end{pmatrix} = \\begin{pmatrix}${B[0]}\\\\${B[1]}\\end{pmatrix}`
                });

                const D = A[0][0] * A[1][1] - A[0][1] * A[1][0];
                steps.push({
                    explanation: 'حساب محدد مصفوفة المعاملات $D$:',
                    equation: `D = (${A[0][0]})(${A[1][1]}) - (${A[0][1]})(${A[1][0]}) = ${fmtNum(D)}`
                });

                if (Math.abs(D) < 1e-10) {
                    return { error: 'المحدد يساوي صفراً ($D = 0$)، لذا لا يوجد حل وحيد للنظام.' };
                }

                const Dx = B[0] * A[1][1] - A[0][1] * B[1];
                const Dy = A[0][0] * B[1] - B[0] * A[1][0];
                steps.push({
                    explanation: 'حساب محددات كرامر $D_x$ و $D_y$:',
                    equation: `D_x = ${fmtNum(Dx)}, \\quad D_y = ${fmtNum(Dy)}`
                });

                const x = Dx / D;
                const y = Dy / D;

                steps.push({
                    explanation: 'إيجاد قيمتي $x$ و $y$ بتطبيق قاعدة كرامر:',
                    equation: `x = \\frac{D_x}{D} = ${fmtNum(x)}, \\quad y = \\frac{D_y}{D} = ${fmtNum(y)}`
                });

                return {
                    title: 'حل نظام معادلات خطية (قاعدة كرامر)',
                    finalResult: `x = ${fmtNum(x)}, \\quad y = ${fmtNum(y)}`,
                    steps
                };
            }
        },

        inequalities: {
            solve(data) {
                const { inequality, operator, left, right, variable = 'x' } = data;
                const steps = [];
                try {
                    const normLeft = normalizeMathInput(left || '');
                    const normRight = normalizeMathInput(right || '0');
                    const zeroExpr = `(${normLeft})-(${normRight})`;
                    const varName = detectVariable(zeroExpr, variable);
                    const includeBoundary = /<=|>=|≤|≥/.test(operator);
                    const isLess = /<|<=|≤/.test(operator);

                    steps.push({ explanation: 'المتباينة الأصلية:', equation: inequality });

                    // تحليل تربيعي أولاً إذا كانت من الدرجة الثانية
                    const quad = fitQuadraticCoeffs(zeroExpr, varName);
                    if (quad && Math.abs(quad.a) > 1e-10) {
                        return this.quadratic(data);
                    }

                    // تحليل خطي مباشر بدون اعتماد إلزامي على nerdamer
                    const lin = fitLinearCoeffs(zeroExpr, varName);
                    if (lin) {
                        const { a, b } = lin;
                        steps.push({
                            explanation: 'نقل الحدود إلى طرف واحد في صورة $ax + b$:',
                            equation: `${fmtNum(a)}${varName} ${b >= 0 ? '+' : '-'} ${fmtNum(Math.abs(b))} ${operator} 0`
                        });

                        if (Math.abs(a) < 1e-10) {
                            const ok = isLess
                                ? (includeBoundary ? b <= 0 : b < 0)
                                : (includeBoundary ? b >= 0 : b > 0);
                            return {
                                title: 'حل متباينة',
                                finalResult: ok ? `${varName} \\in (-\\infty, \\infty)` : `\\emptyset \\text{ (لا يوجد حل)}`,
                                steps
                            };
                        }

                        const boundary = -b / a;
                        const bStr = fmtNum(boundary);
                        // عند القسمة على عدد سالب تنقلب إشارة المتباينة
                        const greaterAfterDiv = a > 0 ? !isLess : isLess;
                        const intervalLatex = greaterAfterDiv
                            ? `${varName} \\in ${includeBoundary ? '[' : '('}${bStr}, \\infty)`
                            : `${varName} \\in (-\\infty, ${bStr}${includeBoundary ? ']' : ')'}`;

                        if (a < 0) {
                            steps.push({
                                explanation: 'عند القسمة على معامل سالب تنعكس إشارة التباين:',
                                equation: `${varName} ${includeBoundary ? (greaterAfterDiv ? '\\ge' : '\\le') : (greaterAfterDiv ? '>' : '<')} ${bStr}`
                            });
                        } else {
                            steps.push({
                                explanation: 'عزل المتغير وتحديد فترة الحل:',
                                equation: intervalLatex
                            });
                        }

                        return { title: 'حل متباينة خطية', finalResult: intervalLatex, steps };
                    }

                    return { error: 'تعذر تحليل المتباينة محلياً.' };
                } catch (e) {
                    return { error: `خطأ في حل المتباينة: ${e.message}` };
                }
            },

            quadratic(data) {
                const { inequality, operator, left, right, variable = 'x' } = data;
                const steps = [];
                try {
                    const normLeft = normalizeMathInput(left || '');
                    const normRight = normalizeMathInput(right || '0');
                    const zeroExpr = `(${normLeft})-(${normRight})`;
                    const varName = detectVariable(zeroExpr, variable);
                    const includeBoundary = /<=|>=|≤|≥/.test(operator);
                    const wantNegative = /<|<=|≤/.test(operator);

                    steps.push({ explanation: 'المتباينة الأصلية:', equation: inequality });

                    const quad = fitQuadraticCoeffs(zeroExpr, varName);
                    if (!quad || Math.abs(quad.a) < 1e-10) {
                        return this.solve(data);
                    }

                    const { a, b, c } = quad;
                    const delta = b * b - 4 * a * c;
                    steps.push({
                        explanation: 'نقل الحدود لطرف واحد وحساب المميز:',
                        equation: `${formatStandardPoly(a, b, c, varName)} ${operator} 0, \\quad \\Delta = ${fmtNum(delta)}`
                    });

                    if (delta < -1e-10) {
                        const alwaysPositive = a > 0;
                        const satisfied = wantNegative ? !alwaysPositive : alwaysPositive;
                        return {
                            title: 'حل متباينة تربيعية',
                            finalResult: satisfied ? `${varName} \\in (-\\infty, \\infty)` : `\\emptyset \\text{ (لا يوجد حل حقيقي)}`,
                            steps
                        };
                    }

                    const r1 = (-b - Math.sqrt(Math.max(0, delta))) / (2 * a);
                    const r2 = (-b + Math.sqrt(Math.max(0, delta))) / (2 * a);
                    const [low, high] = [r1, r2].sort((u, v) => u - v);

                    let resultLatex = '';
                    if (Math.abs(low - high) < 1e-9) {
                        const lStr = fmtNum(low);
                        const outsideMatches = (a > 0 && !wantNegative) || (a < 0 && wantNegative);
                        if (outsideMatches) {
                            resultLatex = includeBoundary
                                ? `${varName} \\in (-\\infty, \\infty)`
                                : `${varName} \\in (-\\infty, ${lStr}) \\cup (${lStr}, \\infty)`;
                        } else {
                            resultLatex = includeBoundary ? `${varName} = ${lStr}` : `\\emptyset`;
                        }
                    } else {
                        const lStr = fmtNum(low);
                        const hStr = fmtNum(high);
                        const insideMatches = (a > 0 && wantNegative) || (a < 0 && !wantNegative);
                        if (insideMatches) {
                            resultLatex = `${varName} \\in ${includeBoundary ? '[' : '('}${lStr}, ${hStr}${includeBoundary ? ']' : ')'}`;
                        } else {
                            const lb = includeBoundary ? ']' : ')';
                            const rb = includeBoundary ? '[' : '(';
                            resultLatex = `${varName} \\in (-\\infty, ${lStr}${lb} \\cup ${rb}${hStr}, \\infty)`;
                        }
                    }

                    steps.push({
                        explanation: `جذور المعادلة المرافقة هي $${fmtNum(low)}$ و $${fmtNum(high)}$، وبفحص إشارة كثيرة الحدود:`,
                        equation: resultLatex
                    });

                    return { title: 'حل متباينة تربيعية', finalResult: resultLatex, steps };
                } catch (e) {
                    return { error: `خطأ في حل المتباينة التربيعية: ${e.message}` };
                }
            }
        }
    },

    solve(data) {
        try {
            const category = data.category;
            const method = data.equationType || data.method || data.type;

            if (category === 'polynomials') {
                if (method === 'add') return this.polynomials.addition.solve(data);
                if (method === 'multiply') return this.polynomials.multiplication.solve(data);
                if (method === 'factoring' || method === 'factor') return this.polynomials.factoring.solve(data);
                if (method === 'expand') return this.polynomials.expanding.solve(data);
                if (method === 'roots') return this.equations.quadratic.solve({ ...data, equation: data.expression || data.equation });
                if (method === 'evaluate') return this.expressions.evaluate(data);
            }

            if (category === 'equations' || category === 'inequalities') {
                if (method === 'inequality' || category === 'inequalities') {
                    const eqText = data.inequality || data.expression || '';
                    let left = data.left;
                    let right = data.right;
                    let operator = data.operator;
                    if (!left && eqText) {
                        const m = eqText.match(/([\s\S]*?)(<=|>=|≤|≥|<|>)([\s\S]*)/);
                        if (m) {
                            left = m[1].trim();
                            operator = m[2];
                            right = m[3].trim();
                        }
                    }
                    if (!operator) return { error: 'يرجى كتابة المتباينة بإشارة مقارنة واضحة (<، >، ≤، ≥).' };
                    return this.equations.inequalities.solve({
                        inequality: eqText || `${left} ${operator} ${right}`,
                        operator,
                        left,
                        right,
                        variable: data.variable
                    });
                }

                if (method === 'linear') return this.equations.linear.solve(data);
                if (method === 'quadratic') return this.equations.quadratic.solve(data);
                if (method === 'system' || method === 'systems') return this.equations.systemsLinear.solve(data);
                if (data.equation || data.expression) {
                    const rawEq = data.equation || data.expression;
                    const normEq = normalizeMathInput(buildZeroExpression(normalizeMathInput(rawEq)));
                    const v = detectVariable(normEq, 'x');
                    if (fitLinearCoeffs(normEq, v)) return this.equations.linear.solve({ equation: rawEq, variable: v });
                    if (fitQuadraticCoeffs(normEq, v)) return this.equations.quadratic.solve({ equation: rawEq, variable: v });
                    return this.equations.numeric.solve({ equation: rawEq, variable: v });
                }
            }

            if (category === 'expressions') {
                if (method === 'simplifyRational') return this.expressions.simplifyRational(data);
                if (method === 'evaluate') return this.expressions.evaluate(data);
            }

            return { error: 'نوع المسألة الجبرية غير مدعوم بعد في الحل المحلي.' };
        } catch (e) {
            console.error('Algebra Solver Error:', e);
            return { error: 'حدث خطأ أثناء المعالجة الجبرية.' };
        }
    },

    expressions: {
        evaluate(data) {
            const math = getMath();
            const rawExpr = data.expression || '';
            const steps = [];
            try {
                let expr = toLatinDigits(rawExpr).trim();
                // تحويل صيغ النسب المئوية الشائعة: "15% من 200" أو "15% * 200"
                expr = expr.replace(/(\d+(?:\.\d+)?)\s*%\s*(?:من|of)\s*(\d+(?:\.\d+)?)/gi, '($1/100)*($2)');
                expr = expr.replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)');

                const normalized = normalizeMathInput(expr);
                const scope = {};
                if (data.param !== undefined && data.param !== null && data.param !== '') {
                    const numParam = Number(toLatinDigits(String(data.param)));
                    if (Number.isFinite(numParam)) scope.x = numParam;
                }

                let parsedTex = normalized;
                try { parsedTex = math.parse(normalized).toTex(); } catch (e) { /* ignore */ }
                steps.push({ explanation: 'كتابة التعبير الرياضي بالصيغة القياسية:', equation: parsedTex });

                const value = math.evaluate(normalized, scope);
                if (typeof value === 'number' && !Number.isFinite(value)) {
                    return { error: 'النتيجة غير معرّفة أو تؤول إلى ما لا نهاية.' };
                }

                let formattedResult = '';
                let fractionNote = '';
                if (typeof value === 'number') {
                    const cleanNum = Math.abs(value) < 1e-12 ? 0 : Number(value.toPrecision(12));
                    formattedResult = String(cleanNum);
                    if (!Number.isInteger(cleanNum)) {
                        try {
                            const frac = math.fraction(cleanNum);
                            if (frac && frac.d > 1 && frac.d <= 1000) {
                                const sign = frac.s < 0 ? '-' : '';
                                fractionNote = ` = ${sign}\\frac{${frac.n}}{${frac.d}}`;
                            }
                        } catch (e) { /* ignore */ }
                    }
                } else {
                    formattedResult = String(value);
                }

                steps.push({
                    explanation: 'حساب القيمة العددية النهائية:',
                    equation: `${parsedTex} = ${formattedResult}${fractionNote}`
                });

                return {
                    title: 'حساب قيمة تعبير رياضي',
                    finalResult: `${formattedResult}${fractionNote}`,
                    numericValue: typeof value === 'number' ? value : undefined,
                    steps
                };
            } catch (e) {
                return { error: `خطأ في تقييم التعبير: ${e.message}` };
            }
        },

        simplifyRational(data) {
            const math = getMath();
            const rawExpr = data.expression || '';
            const steps = [];
            try {
                const norm = normalizeMathInput(rawExpr);
                let origTex = norm;
                try { origTex = math.parse(norm).toTex(); } catch (e) { /* ignore */ }
                steps.push({ explanation: 'التعبير الأصلي:', equation: origTex });

                let simplifiedTex = null;
                let simplifiedRaw = null;
                if (typeof nerdamer !== 'undefined') {
                    try {
                        const nSimp = nerdamer(`simplify(${norm})`);
                        simplifiedRaw = nSimp.toString();
                        simplifiedTex = typeof nSimp.toTeX === 'function' ? nSimp.toTeX() : simplifiedRaw;
                    } catch (e) { /* ignore */ }
                }

                if (!simplifiedTex) {
                    try {
                        const mSimp = math.simplify(norm);
                        simplifiedRaw = mSimp.toString();
                        simplifiedTex = mSimp.toTex();
                    } catch (e) { /* ignore */ }
                }

                if (!simplifiedTex) return { error: 'لا يمكن تبسيط هذا التعبير محلياً.' };

                steps.push({ explanation: 'النتيجة المبسطة:', equation: simplifiedTex });

                const denom = (function findDenominator(expr) {
                    const s = expr.trim();
                    let depth = 0;
                    for (let i = 0; i < s.length; i++) {
                        const ch = s[i];
                        if (ch === '(') depth++;
                        else if (ch === ')') depth--;
                        else if (ch === '/' && depth === 0) return s.slice(i + 1).trim();
                    }
                    return null;
                })(norm);

                let domainNote = '';
                if (denom && typeof nerdamer !== 'undefined') {
                    try {
                        const sol = nerdamer.solve(`${denom}=0`, 'x').toString().replace(/\[|\]/g, '');
                        if (sol) {
                            const roots = sol.split(',').map((s) => s.trim()).filter(Boolean);
                            domainNote = `\\text{الشرط: } x \\neq ${roots.join(', ')}`;
                            steps.push({ explanation: 'شرط وجود الكسر (المقام ≠ 0):', equation: domainNote });
                        }
                    } catch (e) { /* ignore */ }
                }

                return {
                    title: 'تبسيط تعبير جبري',
                    finalResult: simplifiedTex + (domainNote ? `\\; (${domainNote})` : ''),
                    rawResult: simplifiedRaw,
                    steps
                };
            } catch (e) {
                return { error: `خطأ في تبسيط التعبير: ${e.message}` };
            }
        }
    }
};
