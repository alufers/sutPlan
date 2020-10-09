const fetch = require('node-fetch')
const iconv = require('iconv-lite')

const abbrev = {
	'ćw': 'ćwiczenia',
	'wyk': 'wykłady',
	'lab': 'laboratoria'
}

const days = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek']

async function main() {
	if (process.argv.length < 3 || process.argv.includes('--help') || process.argv.includes('-h')) {
		console.log('Użycie: node index.js <id planu> [--json]')
		process.exit(1)
	}

	let res = await getHtml(`https://plan.polsl.pl/plan.php\?type\=0\&id\=${process.argv[2]}\&winW\=0\&winH\=0`)

	const courseDivs = res.match(/<div id="course.*?<\/div>/g)
	let courses = courseDivs.map(x => ({
		top: parseInt(x.match(/top: (\d+)px/)[1], 10),
		left: parseInt(x.match(/left: (\d+)px/)[1], 10),
		content: x.match(/<img.*?>(.*)<\/div>/)[1].trim().split('<br />'),
	}))

	const legend = res.match(/<div class="data">(.*?)<\/div>/)[1]
		.split('<br />')
		.map(x => x.match(/<strong>(.*?)<\/strong> - (.*)/))
		.filter(x => x)
		.map(x => ({ short: x[1], long: x[2].trim() }))
		.reduce((acc, el) => ({ ...acc, [el.short]: el.long }), {})

	const dow = [ 88, 192, 296, 400, 504 ]

	courses = courses
		.map(x => {
			x.subject = x.content[0]
			if (x.content.length === 3) {
				x.lecturer = x.content[1]
				x.room = x.content[2]
			} else {
				x.lecturer = null
				x.room = x.content[1]
			}
			delete x.content

			x.dayOfWeek = dow.indexOf(x.left)
			delete x.left

			if (x.subject.includes('<a href=')) {
				const match = x.subject.match(/href="(.*?)".*?>(.*?)</)
				x.subject = match[2]
				x.link = match[1]
			}

			x.name = legend[x.subject.split(',')[0].trim()]

			const type = x.subject.split(',')[1].trim()
			if (type) {
				x.type = abbrev[type]
			}
			delete x.subject

			const delinkify = str => {
				const arr = Array.from(str.matchAll(/<a href="(.*?)">(.*?)<\/a>/g))
					.map(match => ({
						name: match[2],
						link: 'https://plan.polsl.pl/' + match[1]
					}))
				return arr.length === 1 ? arr[0] : arr
			}

			if (x.lecturer) {
				x.lecturer = delinkify(x.lecturer)
			}

			if (x.room) {
				x.room = x.room.match(/<a href="(.*?)">(.*?)<\/a>/)[2]
			}

			return x
		})


	const lecturers = (await Promise.all(Array.from(new Set(
			courses.flatMap(x => x.lecturer).filter(x => x)
		)).map(async lect => {
			const lectPage = await getHtml(lect.link + '&winW=0&winH=0')
			const long = lectPage.match(/Plan zajęć - (.*?),/)[1].trim()
			return { short: lect.name, long: long.replace(/dr inż\. /g, '') }
		}))).reduce((acc, el) => ({ ...acc, [el.short]: el.long }), {})

	courses = courses
		.map(x => {
			if (x.lecturer) {
				if (Array.isArray(x.lecturer)) {
					x.lecturer = x.lecturer.map(lect => lecturers[lect.name])
				} else {
					x.lecturer = lecturers[x.lecturer.name]
				}
			}

			x.top = Math.round((x.top - 237) / 11.25)
			x.hour = Math.floor(x.top / 4) + 7
			x.minute = (x.top % 4) * 15
			x.time = x.hour.toString().padStart(2, '0') + ':' + x.minute.toString().padStart(2, '0')
			delete x.top

			return x
		})

	if (process.argv.includes('--json')) {
		console.log(JSON.stringify(courses))
	} else {
		courses
			.sort((a, b) => {
				if (a.dayOfWeek === b.dayOfWeek) {
					if (a.hour === b.hour) {
						return a.minute - b.minute
					}
					return a.hour - b.hour
				}
				return a.dayOfWeek - b.dayOfWeek
			})
			.map(course => {
				course.dayOfWeek = days[course.dayOfWeek]
				course.lecturer = Array.isArray(course.lecturer) ? course.lecturer.join(', ') : course.lecturer
				return course
			})

		courses.unshift({
			dayOfWeek: '-----',
			time: '-----',
			name: '-----',
			lecturer: '-----',
			room: '-----'
		})
		courses.unshift({
			dayOfWeek: 'dzień',
			time: 'godzina',
			name: 'przedmiot',
			lecturer: 'wykładowca',
			room: 'sala'
		})
		courses = padToEqual(courses, 'dayOfWeek')
		courses = padToEqual(courses, 'time')
		courses = padToEqual(courses, 'name')
		courses = padToEqual(courses, 'lecturer')

		courses.forEach(course => {
			console.log(`${course.dayOfWeek}  ${course.time}  ${course.name}  ${course.lecturer}  ${course.room}`)
		})
	}
}
main()

async function getHtml (url) {
	let res = await fetch(url).then(res => res.buffer())
	res = iconv.decode(res, 'windows-1250')
	res = res.replace(/[\r\n]/g, '')
	return res
}

function padToEqual(array, property) {
	const max = Math.max(...array.map(el => el[property]?.length ?? 0))
	return array.map(el => {
		if (!el[property]) el[property] = '<null>'
		el[property] = el[property].padEnd(max, ' ')
		return el
	})
}
